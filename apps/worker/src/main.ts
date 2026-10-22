import { serviceName } from '@sonavra/config';
import { createDatabase } from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';
import {
  DockerFasterWhisperEngine,
  DockerMediaPreprocessor,
} from '@sonavra/transcription';

import { GuestCleanup } from './guest-cleanup.js';
import { TranscriptionJobProcessor } from './transcription-jobs.js';

const database = createDatabase();
const storage = createS3ObjectStorageFromEnv();
const runtimeContainer =
  process.env.SONAVRA_TRANSCRIPTION_RUNTIME_CONTAINER ??
  'sonavra-transcription-runtime';
const preprocessor = new DockerMediaPreprocessor({
  container: runtimeContainer,
});
const engine = new DockerFasterWhisperEngine({
  container: runtimeContainer,
  model: process.env.SONAVRA_TRANSCRIPTION_MODEL,
  device: process.env.SONAVRA_TRANSCRIPTION_DEVICE === 'cuda' ? 'cuda' : 'cpu',
  computeType: process.env.SONAVRA_TRANSCRIPTION_COMPUTE_TYPE,
  diarizationModel: process.env.SONAVRA_DIARIZATION_MODEL,
});
const processor = new TranscriptionJobProcessor(
  database,
  storage,
  preprocessor,
  engine,
);

const pollMs = Number(process.env.SONAVRA_WORKER_POLL_MS ?? 1000);
let stopping = false;
const cleanup = new GuestCleanup(database, storage);
let cleanupRun: Promise<void> | undefined;
function sweep() {
  if (stopping || cleanupRun) return;
  cleanupRun = cleanup
    .run()
    .then((result) => {
      if (result.deleted || result.failed || result.sessions)
        console.log('guest cleanup', result);
    })
    .catch(() => {
      console.error('guest cleanup failed; retrying on next sweep');
    })
    .finally(() => {
      cleanupRun = undefined;
    });
}
const cleanupTimer = setInterval(sweep, 60_000);

async function run() {
  console.log(`${serviceName} worker ready`, {
    queue: 'postgresql',
    engine: engine.name,
  });

  sweep();
  while (!stopping) {
    try {
      const processed = await processor.processNext();
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      console.error('worker loop failed', error);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  clearInterval(cleanupTimer);
  await cleanupRun;
  await database.$disconnect();
}

function shutdown() {
  stopping = true;
  clearInterval(cleanupTimer);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

void run();
