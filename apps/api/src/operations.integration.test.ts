import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase } from '@sonavra/database';
import { configureOperations, RequestLimiter } from './operations.js';

const integration = { skip: !process.env.DATABASE_URL };
test(
  'rate counters are atomic across instances, expire using database time and store no raw client addresses',
  integration,
  async () => {
    const database = createDatabase();
    const namespace = randomUUID();
    const clients = [
      new RequestLimiter(database, namespace),
      new RequestLimiter(database, namespace),
    ];
    const category = { name: randomUUID(), limit: 3, windowMs: 60_000 };
    let key: string | undefined;
    try {
      const attempts = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          clients[i % 2]!.take('synthetic-client', category),
        ),
      );
      assert.equal(attempts.filter((item) => item.allowed).length, 3);
      const { createHash } = await import('node:crypto');
      key = createHash('sha256')
        .update(`${namespace}:synthetic-client:${category.name}`)
        .digest('hex');
      const counter = await database.requestRateLimit.findUniqueOrThrow({
        where: { key },
      });
      assert.equal(counter.hits, 4);
      assert.doesNotMatch(counter.key, /synthetic-client/);
      await database.requestRateLimit.update({
        where: { key },
        data: { expiresAt: new Date(0) },
      });
      assert.equal(
        (await clients[0]!.take('synthetic-client', category)).allowed,
        true,
      );
    } finally {
      if (key) await database.requestRateLimit.deleteMany({ where: { key } });
      await database.$disconnect();
    }
  },
);

test(
  'operational HTTP controls correlate uploads, reject spoofed limits, sanitize errors and protect readiness',
  integration,
  async () => {
    const database = createDatabase();
    const namespace = randomUUID();
    const previous = process.env.SONAVRA_HEALTH_TOKEN;
    process.env.SONAVRA_HEALTH_TOKEN = 'synthetic-health-token-'.repeat(3);
    const logs: string[] = [];
    const logger = mock.method(console, 'log', (line: unknown) => {
      logs.push(String(line));
    });
    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
      bodyParser: false,
    });
    configureOperations(app, database, {
      rateLimiting: true,
      trustProxy: false,
      namespace,
    });
    app.useBodyParser('json', { limit: '128kb' });
    let guestId: string | undefined;
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const requestId = randomUUID();
      const upload = await fetch(
        `${origin}/uploads?private=never-log-this-query`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': requestId,
          },
          body: JSON.stringify({
            filename: 'never-log-this-filename.ogg',
            mimeType: 'audio/ogg',
            sizeBytes: 10,
          }),
        },
      );
      assert.equal(upload.status, 201);
      assert.equal(upload.headers.get('x-request-id'), requestId);
      assert.equal(upload.headers.get('cache-control'), 'no-store');
      const created = (await upload.json()) as {
        recordingId: string;
        guestSessionId: string;
      };
      guestId = created.guestSessionId;
      assert.equal(
        (
          await database.recording.findUniqueOrThrow({
            where: { id: created.recordingId },
          })
        ).requestId,
        requestId,
      );
      assert.ok(
        logs.some((line) => {
          const log = JSON.parse(line);
          return (
            log.event === 'upload_created' &&
            log.requestId === requestId &&
            log.recordingId === created.recordingId
          );
        }),
      );
      await database.recording.update({
        where: { id: created.recordingId },
        data: { status: 'FAILED' },
      });
      const failedJob = await database.transcriptionJob.create({
        data: {
          recordingId: created.recordingId,
          status: 'FAILED',
          errorCode: 'transcription_failed',
          errorMessage: 'never-log-this-runtime-secret',
        },
      });
      for (const path of [
        `/recordings/${created.recordingId}/status`,
        `/transcription-jobs/${failedJob.id}`,
      ]) {
        const response = await fetch(
          `${origin}${path}?guestSessionId=${created.guestSessionId}`,
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(
          await response.text(),
          /never-log-this-runtime-secret/,
        );
      }
      for (let i = 0; i < 9; i++) {
        assert.equal(
          (
            await fetch(`${origin}/uploads`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-forwarded-for': `192.0.2.${i + 1}`,
              },
              body: '{}',
            })
          ).status,
          400,
        );
      }
      const limited = await fetch(`${origin}/uploads`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.1',
        },
        body: '{}',
      });
      assert.equal(limited.status, 429);
      assert.equal(
        (
          await fetch(`${origin}/UpLoAdS/`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
        429,
      );
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal((await fetch(`${origin}/health`)).status, 200);
      assert.equal((await fetch(`${origin}/ready`)).status, 404);
      assert.equal(
        (
          await fetch(`${origin}/ready`, {
            headers: {
              authorization: `Bearer ${process.env.SONAVRA_HEALTH_TOKEN}`,
            },
          })
        ).status,
        200,
      );
      const malformed = await fetch(`${origin}/auth/signin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"never-log-this-body"',
      });
      assert.equal(malformed.status, 400);
      assert.doesNotMatch(await malformed.text(), /never-log/);
      const oversized = await fetch(`${origin}/auth/signin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(140000) }),
      });
      assert.equal(oversized.status, 413);
      assert.doesNotMatch(
        logs.join('\n'),
        /never-log|synthetic-health-token|authorization|X-Amz/,
      );
    } finally {
      await app.close();
      logger.mock.restore();
      if (previous === undefined) delete process.env.SONAVRA_HEALTH_TOKEN;
      else process.env.SONAVRA_HEALTH_TOKEN = previous;
      if (guestId)
        await database.guestSession.deleteMany({ where: { id: guestId } });
      const { createHash } = await import('node:crypto');
      await database.requestRateLimit.deleteMany({
        where: {
          key: {
            in: ['upload', 'auth', 'read'].flatMap((name) =>
              ['127.0.0.1', '::ffff:127.0.0.1'].map((client) =>
                createHash('sha256')
                  .update(`${namespace}:${client}:${name}`)
                  .digest('hex'),
              ),
            ),
          },
        },
      });
      await database.$disconnect();
    }
  },
);
