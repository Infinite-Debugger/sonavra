import { createServer } from 'node:http';
import type { PrismaClient } from '@sonavra/database';
import { healthAuthorized } from '@sonavra/config';
import type { TranscriptionJobProcessor } from './transcription-jobs.js';

type RuntimeStatus = { ready: boolean; checks: Record<string, boolean> };
type QueueStatus = {
  queued: number;
  processing: number;
  failed: number;
  completed: number;
  stalled: number;
  oldestQueuedMs: number;
};

export class WorkerHealth {
  databaseReady = false;
  runtime: RuntimeStatus = { ready: false, checks: {} };
  queue: QueueStatus | null = null;
  lastLoopAt = Date.now();
  lastRuntimeProbeAt = 0;
  lastDatabaseProbeAt = 0;
  probing = false;
  constructor(
    private readonly database: Pick<PrismaClient, '$queryRaw'>,
    private readonly checkRuntime: () => Promise<RuntimeStatus>,
    readonly metrics: TranscriptionJobProcessor['metrics'],
  ) {}

  get ready() {
    const active = this.metrics.active > 0;
    return (
      this.databaseReady &&
      Date.now() - this.lastDatabaseProbeAt < 120_000 &&
      this.runtime.ready &&
      (active ||
        (Date.now() - this.lastLoopAt < 30_000 &&
          Date.now() - this.lastRuntimeProbeAt < 120_000))
    );
  }

  async refresh() {
    try {
      const [queue] = await this.database.$queryRaw<QueueStatus[]>`
        SELECT COUNT(*) FILTER (WHERE "status" = 'QUEUED')::int AS queued,
          COUNT(*) FILTER (WHERE "status" = 'PROCESSING')::int AS processing,
          COUNT(*) FILTER (WHERE "status" = 'FAILED')::int AS failed,
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE "status" = 'PROCESSING' AND "leaseExpiresAt" < NOW())::int AS stalled,
          COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (NOW() - MIN("availableAt") FILTER (WHERE "status" = 'QUEUED'))) * 1000), 0)::double precision AS "oldestQueuedMs"
        FROM "TranscriptionJob"
      `;
      this.queue = queue ?? null;
      this.databaseReady = Boolean(queue);
    } catch {
      this.databaseReady = false;
      this.queue = null;
    }
    this.lastDatabaseProbeAt = Date.now();
    if (!this.metrics.active) {
      this.probing = true;
      try {
        this.runtime = await this.checkRuntime();
      } catch {
        this.runtime = { ready: false, checks: {} };
      }
      this.lastRuntimeProbeAt = Date.now();
      this.probing = false;
    }
  }

  snapshot() {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      status: this.ready ? 'ready' : 'unavailable',
      database: this.databaseReady,
      databaseCheckedAt: this.lastDatabaseProbeAt
        ? new Date(this.lastDatabaseProbeAt).toISOString()
        : null,
      runtime: this.runtime,
      probing: this.probing,
      runtimeCheckedAt: this.lastRuntimeProbeAt
        ? new Date(this.lastRuntimeProbeAt).toISOString()
        : null,
      queue: this.queue,
      metrics: { ...this.metrics },
      resources: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
      },
    };
  }
}

export function createWorkerHealthServer(
  health: WorkerHealth,
  token = process.env.SONAVRA_HEALTH_TOKEN,
) {
  return createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-type', 'application/json');
    if (
      request.method !== 'GET' ||
      (request.url !== '/health' && request.url !== '/ready')
    ) {
      response.writeHead(404);
      response.end('{}');
      return;
    }
    if (request.url === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (!healthAuthorized(request.headers.authorization, token)) {
      response.writeHead(404);
      response.end('{}');
      return;
    }
    response.writeHead(health.ready ? 200 : 503);
    response.end(JSON.stringify(health.snapshot()));
  });
}
