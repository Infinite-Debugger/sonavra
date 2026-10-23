import {
  ConfigurationError,
  logEvent,
  positiveInteger,
  validateProductionConfiguration,
} from '@sonavra/config';
import { createDatabase } from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';
import {
  checkDockerRuntime,
  DockerFasterWhisperEngine,
  DockerMediaPreprocessor,
} from '@sonavra/transcription';
import { GuestCleanup } from './guest-cleanup.js';
import { createWorkerHealthServer, WorkerHealth } from './health.js';
import { TranscriptionJobProcessor } from './transcription-jobs.js';

async function run() {
  validateProductionConfiguration('worker');
  const pollMs = positiveInteger('SONAVRA_WORKER_POLL_MS', 1000);
  const port = positiveInteger('SONAVRA_WORKER_HEALTH_PORT', 3002);
  positiveInteger('SONAVRA_MAX_DURATION_SECONDS', 14400);
  const database = createDatabase();
  const storage = createS3ObjectStorageFromEnv();
  const options = {
    container:
      process.env.SONAVRA_TRANSCRIPTION_RUNTIME_CONTAINER ??
      'sonavra-transcription-runtime',
    model: process.env.SONAVRA_TRANSCRIPTION_MODEL,
    device:
      process.env.SONAVRA_TRANSCRIPTION_DEVICE === 'cuda'
        ? ('cuda' as const)
        : ('cpu' as const),
    computeType: process.env.SONAVRA_TRANSCRIPTION_COMPUTE_TYPE,
    diarizationModel: process.env.SONAVRA_DIARIZATION_MODEL,
  };
  const processor = new TranscriptionJobProcessor(
    database,
    storage,
    new DockerMediaPreprocessor(options),
    new DockerFasterWhisperEngine(options),
  );
  const health = new WorkerHealth(
    database,
    () => checkDockerRuntime(options),
    processor.metrics,
  );
  const server = createWorkerHealthServer(health);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const cleanup = new GuestCleanup(database, storage);
  let stopping = false;
  let sweepRun: Promise<void> | undefined;
  function sweep() {
    if (stopping || sweepRun) return;
    sweepRun = (async () => {
      try {
        const result = await cleanup.run();
        if (result.deleted || result.failed || result.sessions)
          logEvent('worker', 'guest_cleanup', result);
        await database.$executeRaw`DELETE FROM "RequestRateLimit" WHERE "key" IN (SELECT "key" FROM "RequestRateLimit" WHERE "expiresAt" < NOW() LIMIT 1000)`;
      } catch {
        logEvent('worker', 'cleanup_failed');
      }
      await health.refresh();
      logEvent('worker', health.ready ? 'ready' : 'not_ready');
    })().finally(() => {
      sweepRun = undefined;
    });
  }
  const timer = setInterval(sweep, 60_000);
  function shutdown() {
    stopping = true;
    clearInterval(timer);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  logEvent('worker', 'started');
  sweep();
  try {
    while (!stopping) {
      health.lastLoopAt = Date.now();
      try {
        const processed =
          health.ready && !health.probing && (await processor.processNext());
        if (!processed)
          await new Promise((resolve) => setTimeout(resolve, pollMs));
      } catch {
        health.databaseReady = false;
        logEvent('worker', 'loop_failed');
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  } finally {
    clearInterval(timer);
    await sweepRun;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.$disconnect();
  }
}
void run().catch((error: unknown) => {
  logEvent('worker', 'startup_failed', {
    errorCode:
      error instanceof ConfigurationError
        ? error.fields.join(',')
        : 'startup_failed',
  });
  process.exitCode = 1;
});
