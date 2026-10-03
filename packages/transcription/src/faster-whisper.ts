import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TranscriptionEngineError } from './errors.js';
import type {
  TranscriptionEngine,
  TranscriptionRequest,
  TranscriptionResult,
} from './types.js';

export interface FasterWhisperEngineOptions {
  pythonExecutable?: string;
  runtimePath?: string;
  model?: string;
  modelCache?: string;
  device?: 'cpu' | 'cuda';
  computeType?: string;
  diarizationModel?: string;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export class FasterWhisperEngine implements TranscriptionEngine {
  readonly name = 'faster-whisper';

  private readonly pythonExecutable: string;
  private readonly runtimePath: string;
  private readonly model: string;
  private readonly modelCache?: string;
  private readonly device: 'cpu' | 'cuda';
  private readonly computeType: string;
  private readonly diarizationModel?: string;
  private readonly minSpeakers?: number;
  private readonly maxSpeakers?: number;

  constructor(options: FasterWhisperEngineOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? 'python3';
    this.runtimePath =
      options.runtimePath ??
      fileURLToPath(new URL('../runtime/whisper_runtime.py', import.meta.url));
    this.model = options.model ?? 'small';
    this.modelCache = options.modelCache;
    this.device = options.device ?? 'cpu';
    this.computeType =
      options.computeType ?? (this.device === 'cpu' ? 'int8' : 'float16');
    this.diarizationModel = options.diarizationModel;
    this.minSpeakers = options.minSpeakers;
    this.maxSpeakers = options.maxSpeakers;
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (request.source.kind !== 'file') {
      throw new TranscriptionEngineError(
        'The self-hosted Whisper engine requires a local media file.',
        { code: 'invalid_request', retryable: false, engine: this.name },
      );
    }

    if (request.diarization && !this.diarizationModel) {
      throw new TranscriptionEngineError(
        'Speaker diarization was requested but no local diarization model is configured.',
        { code: 'model_unavailable', retryable: false, engine: this.name },
      );
    }

    const args = [
      this.runtimePath,
      '--model',
      this.model,
      '--device',
      this.device,
      '--compute-type',
      this.computeType,
    ];

    if (this.modelCache) args.push('--model-cache', this.modelCache);
    if (request.language) args.push('--language', request.language);
    if (request.detectLanguage) args.push('--detect-language');

    if (request.diarization && this.diarizationModel) {
      args.push('--diarization-model', this.diarizationModel);
      if (this.minSpeakers !== undefined)
        args.push('--min-speakers', String(this.minSpeakers));
      if (this.maxSpeakers !== undefined)
        args.push('--max-speakers', String(this.maxSpeakers));
    }

    args.push(request.source.path);
    return this.run(args);
  }

  private run(args: string[]): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (cause) => {
        reject(
          new TranscriptionEngineError(
            'Unable to start the self-hosted transcription runtime.',
            {
              code: 'runtime_unavailable',
              retryable: false,
              engine: this.name,
              cause,
            },
          ),
        );
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new TranscriptionEngineError(
              stderr.trim() ||
                `Transcription runtime exited with code ${code ?? 'unknown'}.`,
              {
                code: 'transcription_failed',
                retryable: true,
                engine: this.name,
              },
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(stdout) as TranscriptionResult);
        } catch (cause) {
          reject(
            new TranscriptionEngineError(
              'Transcription runtime returned invalid JSON.',
              {
                code: 'invalid_response',
                retryable: false,
                engine: this.name,
                cause,
              },
            ),
          );
        }
      });
    });
  }
}
