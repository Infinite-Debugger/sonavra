import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { TranscriptionEngineError } from './errors.js';
import type { NormalizedMedia } from './media-preprocessor.js';
import type {
  TranscriptionEngine,
  TranscriptionRequest,
  TranscriptionResult,
} from './types.js';

interface DockerRuntimeOptions {
  container?: string;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5 * 60_000);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 16 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-65536);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(stderr.trim() || `${command} exited with code ${code}`),
        );
    });
  });
}

export class DockerMediaPreprocessor {
  private readonly container: string;
  private readonly maxDurationSeconds = Number(
    process.env.SONAVRA_MAX_DURATION_SECONDS ?? 14400,
  );

  constructor(options: DockerRuntimeOptions = {}) {
    this.container = options.container ?? 'sonavra-transcription-runtime';
  }

  async normalize(sourcePath: string): Promise<NormalizedMedia> {
    const id = randomUUID();
    const containerDir = `/tmp/sonavra-${id}`;
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sonavra-media-'));
    const outputPath = join(workingDirectory, 'normalized.wav');

    try {
      await run('docker', [
        'exec',
        this.container,
        'mkdir',
        '-p',
        containerDir,
      ]);
      await run('docker', [
        'cp',
        sourcePath,
        `${this.container}:${containerDir}/source`,
      ]);
      await run('docker', [
        'exec',
        this.container,
        'timeout',
        '--signal=KILL',
        '300',
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        `${containerDir}/source`,
        '-t',
        String(this.maxDurationSeconds + 1),
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        `${containerDir}/normalized.wav`,
      ]);
      const duration = Number(
        await run('docker', [
          'exec',
          this.container,
          'ffprobe',
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          `${containerDir}/normalized.wav`,
        ]),
      );
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > this.maxDurationSeconds
      )
        throw new TranscriptionEngineError(
          'Media exceeds the transcription duration limit or has an invalid duration.',
          {
            code: 'media_error',
            retryable: false,
            engine: 'media-preprocessor',
          },
        );
      await run('docker', [
        'cp',
        `${this.container}:${containerDir}/normalized.wav`,
        outputPath,
      ]);
    } catch (cause) {
      await rm(workingDirectory, { recursive: true, force: true });
      if (cause instanceof TranscriptionEngineError) throw cause;
      throw new TranscriptionEngineError(
        'Unable to preprocess media in the Docker transcription runtime.',
        {
          code: 'runtime_unavailable',
          retryable: false,
          engine: 'media-preprocessor',
          cause,
        },
      );
    } finally {
      await run('docker', [
        'exec',
        this.container,
        'rm',
        '-rf',
        containerDir,
      ]).catch(() => undefined);
    }

    return {
      path: outputPath,
      sampleRate: 16_000,
      channels: 1,
      dispose: () => rm(workingDirectory, { recursive: true, force: true }),
    };
  }
}

export interface DockerFasterWhisperEngineOptions extends DockerRuntimeOptions {
  model?: string;
  device?: 'cpu' | 'cuda';
  computeType?: string;
  diarizationModel?: string;
}

export class DockerFasterWhisperEngine implements TranscriptionEngine {
  readonly name = 'faster-whisper';
  private readonly container: string;
  private readonly model: string;
  private readonly device: 'cpu' | 'cuda';
  private readonly computeType: string;
  private readonly diarizationModel?: string;

  constructor(options: DockerFasterWhisperEngineOptions = {}) {
    this.container = options.container ?? 'sonavra-transcription-runtime';
    this.model = options.model ?? 'small';
    this.device = options.device ?? 'cpu';
    this.computeType =
      options.computeType ?? (this.device === 'cpu' ? 'int8' : 'float16');
    this.diarizationModel = options.diarizationModel;
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (request.source.kind !== 'file') {
      throw new TranscriptionEngineError(
        'Docker transcription requires a local media file.',
        {
          code: 'invalid_request',
          retryable: false,
          engine: this.name,
        },
      );
    }

    if (request.diarization && !this.diarizationModel)
      throw new TranscriptionEngineError(
        'A local diarization model is required.',
        { code: 'model_unavailable', retryable: false, engine: this.name },
      );
    const id = randomUUID();
    const mediaPath = `/tmp/sonavra-${id}.wav`;
    try {
      await run('docker', [
        'cp',
        request.source.path,
        `${this.container}:${mediaPath}`,
      ]);
      const args = [
        'exec',
        '-e',
        'HF_HUB_OFFLINE=1',
        '-e',
        'TRANSFORMERS_OFFLINE=1',
        ...(request.correlation
          ? Object.entries(request.correlation).flatMap(([key, value]) => [
              '-e',
              `SONAVRA_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}=${value}`,
            ])
          : []),
        this.container,
        'timeout',
        '--signal=KILL',
        '300',
        'python',
        '/runtime/whisper_runtime.py',
        '--model',
        this.model,
        '--device',
        this.device,
        '--compute-type',
        this.computeType,
        '--model-cache',
        '/models/whisper',
      ];
      if (request.language) args.push('--language', request.language);
      if (request.detectLanguage) args.push('--detect-language');
      if (request.diarization && this.diarizationModel) {
        args.push('--diarization-model', this.diarizationModel);
      }
      args.push(mediaPath);
      const stdout = await run('docker', args);
      return JSON.parse(stdout) as TranscriptionResult;
    } catch (cause) {
      throw new TranscriptionEngineError(
        'The self-hosted transcription runtime failed.',
        {
          code: 'transcription_failed',
          retryable: true,
          engine: this.name,
          cause,
        },
      );
    } finally {
      await run('docker', [
        'exec',
        this.container,
        'rm',
        '-f',
        mediaPath,
      ]).catch(() => undefined);
    }
  }
}

export async function checkDockerRuntime(
  options: DockerFasterWhisperEngineOptions = {},
) {
  const args = [
    'exec',
    '-e',
    `SONAVRA_TRANSCRIPTION_MODEL=${options.model ?? 'small'}`,
    '-e',
    `SONAVRA_TRANSCRIPTION_DEVICE=${options.device ?? 'cpu'}`,
    '-e',
    `SONAVRA_TRANSCRIPTION_COMPUTE_TYPE=${options.computeType ?? (options.device === 'cuda' ? 'float16' : 'int8')}`,
    '-e',
    `SONAVRA_DIARIZATION_MODEL=${options.diarizationModel ?? ''}`,
    options.container ?? 'sonavra-transcription-runtime',
    'timeout',
    '--signal=KILL',
    '55',
    'python',
    '/runtime/runtime_check.py',
  ];
  const parse = (stdout: string) => {
    const value = JSON.parse(stdout) as {
      ready?: boolean;
      checks?: Record<string, boolean>;
    };
    return {
      ready:
        value.ready === true &&
        ['ffmpeg', 'whisper', 'diarization', 'device'].every(
          (key) => value.checks?.[key] === true,
        ),
      checks: Object.fromEntries(
        ['ffmpeg', 'whisper', 'diarization', 'device'].map((key) => [
          key,
          value.checks?.[key] === true,
        ]),
      ),
    };
  };
  try {
    const { stdout } = await promisify(execFile)('docker', args, {
      timeout: 60000,
      maxBuffer: 65536,
    });
    return parse(stdout);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    ) {
      try {
        return parse(error.stdout);
      } catch {
        /* Invalid probe output remains unavailable. */
      }
    }
    return { ready: false, checks: {} as Record<string, boolean> };
  }
}
