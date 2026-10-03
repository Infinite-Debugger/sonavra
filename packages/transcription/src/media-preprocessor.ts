import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { TranscriptionEngineError } from './errors.js';

export interface MediaPreprocessorOptions {
  ffmpegExecutable?: string;
  sampleRate?: number;
  channels?: number;
}

export interface NormalizedMedia {
  path: string;
  sampleRate: number;
  channels: number;
  dispose(): Promise<void>;
}

export class MediaPreprocessor {
  private readonly ffmpegExecutable: string;
  private readonly sampleRate: number;
  private readonly channels: number;

  constructor(options: MediaPreprocessorOptions = {}) {
    this.ffmpegExecutable = options.ffmpegExecutable ?? 'ffmpeg';
    this.sampleRate = options.sampleRate ?? 16_000;
    this.channels = options.channels ?? 1;
  }

  async normalize(sourcePath: string): Promise<NormalizedMedia> {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sonavra-media-'));
    const outputPath = join(workingDirectory, `${basename(sourcePath)}.wav`);

    try {
      await this.runFfmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        sourcePath,
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        String(this.channels),
        '-ar',
        String(this.sampleRate),
        '-c:a',
        'pcm_s16le',
        outputPath,
      ]);
    } catch (error) {
      await rm(workingDirectory, { recursive: true, force: true });
      throw error;
    }

    let disposed = false;
    return {
      path: outputPath,
      sampleRate: this.sampleRate,
      channels: this.channels,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await rm(workingDirectory, { recursive: true, force: true });
      },
    };
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegExecutable, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (cause) => {
        reject(
          new TranscriptionEngineError(
            'Unable to start the local FFmpeg runtime.',
            {
              code: 'runtime_unavailable',
              retryable: false,
              engine: 'media-preprocessor',
              cause,
            },
          ),
        );
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new TranscriptionEngineError(
            stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}.`,
            {
              code: 'media_error',
              retryable: false,
              engine: 'media-preprocessor',
            },
          ),
        );
      });
    });
  }
}
