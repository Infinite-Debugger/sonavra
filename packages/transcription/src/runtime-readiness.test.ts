import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DockerFasterWhisperEngine } from './docker-runtime.js';
import { TranscriptionEngineError } from './errors.js';

test('readiness loads local models offline and distinguishes missing components', () => {
  execFileSync(
    'python3',
    [
      '-m',
      'unittest',
      'discover',
      '-s',
      fileURLToPath(new URL('../test/', import.meta.url)),
      '-p',
      '*_test.py',
    ],
    { stdio: 'pipe' },
  );
});

test('Docker engine never silently skips requested diarization', async () => {
  const engine = new DockerFasterWhisperEngine();
  await assert.rejects(
    () =>
      engine.transcribe({
        source: { kind: 'file', path: '/tmp/synthetic.wav' },
        diarization: true,
      }),
    (error: unknown) =>
      error instanceof TranscriptionEngineError &&
      error.code === 'model_unavailable' &&
      !error.retryable,
  );
});
