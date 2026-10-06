import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export class DockerMediaPreprocessor {
  private readonly container: string;

  constructor(options: DockerRuntimeOptions = {}) {
    this.container = options.container ?? 'sonavra-transcription-runtime';
  }

  async normalize(sourcePath: string): Promise<NormalizedMedia> {
    const id = randomUUID();
    const containerDir = `/tmp/sonavra-${id}`;
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sonavra-media-'));
    const outputPath = join(workingDirectory, 'normalized.wav');

    try {
      await run('docker', ['exec', this.container, 'mkdir', '-p', containerDir]);
      await run('docker', ['cp', sourcePath, `${this.container}:${containerDir}/source`]);
      await run('docker', [
        'exec',
        this.container,
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        `${containerDir}/source`,
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
      await run('docker', [
        'cp',
        `${this.container}:${containerDir}/normalized.wav`,
        outputPath,
      ]);
    } catch (cause) {
      await rm(workingDirectory, { recursive: true, force: true });
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
      await run('docker', ['exec', this.container, 'rm', '-rf', containerDir]).catch(
        () => undefined,
      );
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
    this.computeType = options.computeType ?? (this.device === 'cpu' ? 'int8' : 'float16');
    this.diarizationModel = options.diarizationModel;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (request.source.kind !== 'file') {
      throw new TranscriptionEngineError('Docker transcription requires a local media file.', {
        code: 'invalid_request',
        retryable: false,
        engine: this.name,
      });
    }

    const id = randomUUID();
    const mediaPath = `/tmp/sonavra-${id}.wav`;
    try {
      await run('docker', ['cp', request.source.path, `${this.container}:${mediaPath}`]);
      const args = [
        'exec',
        this.container,
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
        cause instanceof Error ? cause.message : 'Docker transcription failed.',
        {
          code: 'transcription_failed',
          retryable: true,
          engine: this.name,
          cause,
        },
      );
    } finally {
      await run('docker', ['exec', this.container, 'rm', '-f', mediaPath]).catch(
        () => undefined,
      );
    }
  }
}
