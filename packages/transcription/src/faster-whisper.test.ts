import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { FasterWhisperEngine } from './faster-whisper.js';
import { TranscriptionEngineError } from './errors.js';

const fixture = fileURLToPath(
  new URL('../test/fake_runtime.py', import.meta.url),
);
const failingFixture = fileURLToPath(
  new URL('../test/failing_runtime.py', import.meta.url),
);

test('transcribes through a local runtime without hosted credentials', async () => {
  const engine = new FasterWhisperEngine({ runtimePath: fixture });
  const result = await engine.transcribe({
    source: { kind: 'file', path: '/tmp/audio.wav' },
  });

  assert.equal(result.engine, 'faster-whisper');
  assert.equal(result.segments[0]?.text, 'Hello');
  assert.equal(result.segments[0]?.startMs, 0);
  assert.equal(result.segments[0]?.endMs, 900);
});

test('returns normalized local speaker identities when diarization is enabled', async () => {
  const engine = new FasterWhisperEngine({
    runtimePath: fixture,
    diarizationModel: '/models/diarization',
  });
  const result = await engine.transcribe({
    source: { kind: 'file', path: '/tmp/audio.wav' },
    diarization: true,
  });

  assert.equal(result.speakers.length, 2);
  assert.equal(result.segments[0]?.speakerId, 'SPEAKER_00');
  assert.equal(result.segments[1]?.speakerId, 'SPEAKER_01');
});

test('fails deterministically when diarization has no local model', async () => {
  const engine = new FasterWhisperEngine({ runtimePath: fixture });

  await assert.rejects(
    engine.transcribe({
      source: { kind: 'file', path: '/tmp/audio.wav' },
      diarization: true,
    }),
    (error: unknown) =>
      error instanceof TranscriptionEngineError &&
      error.code === 'model_unavailable' &&
      error.retryable === false,
  );
});

test('surfaces local runtime failures instead of falling back to hosted inference', async () => {
  const engine = new FasterWhisperEngine({ runtimePath: failingFixture });

  await assert.rejects(
    engine.transcribe({ source: { kind: 'file', path: '/tmp/audio.wav' } }),
    (error: unknown) =>
      error instanceof TranscriptionEngineError &&
      error.code === 'transcription_failed' &&
      error.retryable === true,
  );
});
