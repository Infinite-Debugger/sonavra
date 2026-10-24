import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@sonavra/database';
import { createWorkerHealthServer, WorkerHealth } from './health.js';

test('worker readiness distinguishes database, runtime and stale-loop failures without raw diagnostics', async () => {
  let databaseFailed = false;
  let modelReady = true;
  const database = {
    $queryRaw: async () => {
      if (databaseFailed) throw new Error('private database details');
      return [
        {
          queued: 2,
          processing: 1,
          failed: 0,
          completed: 3,
          stalled: 0,
          oldestQueuedMs: 1000,
        },
      ];
    },
  } as unknown as PrismaClient;
  const metrics = {
    active: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    discarded: 0,
    totalDurationMs: 0,
  };
  const health = new WorkerHealth(
    database,
    async () => ({
      ready: modelReady,
      checks: { whisper: modelReady, diarization: modelReady },
    }),
    metrics,
  );
  await health.refresh();
  assert.equal(health.ready, true);
  assert.equal(health.snapshot().queue?.queued, 2);
  modelReady = false;
  await health.refresh();
  assert.equal(health.ready, false);
  assert.equal(health.snapshot().runtime.checks.whisper, false);
  modelReady = true;
  databaseFailed = true;
  await health.refresh();
  assert.equal(health.ready, false);
  assert.equal(health.snapshot().database, false);
  assert.doesNotMatch(JSON.stringify(health.snapshot()), /private database/);
  databaseFailed = false;
  await health.refresh();
  health.lastLoopAt = 0;
  assert.equal(health.ready, false);
  metrics.active = 1;
  assert.equal(health.ready, true);
  health.lastDatabaseProbeAt = 0;
  assert.equal(health.ready, false);
  health.lastDatabaseProbeAt = Date.now();
  metrics.active = 0;
  health.lastLoopAt = Date.now();
  const server = createWorkerHealthServer(health, 'test-token');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 404);
    const response = await fetch(`http://127.0.0.1:${port}/ready`, {
      headers: { authorization: 'Bearer test-token' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
