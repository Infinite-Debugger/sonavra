import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@sonavra/database';
import { AuthService, authOrigin } from './auth.js';
import { claimGuestRecordings } from './guest-claims.js';
import { recordingAccess } from './recording-access.js';
import { SummaryError } from './summary-generator.js';
import { TranscriptSummaryService } from './transcript-summaries.js';

const output = {
  text: 'The team planned a Friday release.',
  keyPoints: ['Release is scheduled for Friday.'],
  actionItems: ['Sam will prepare notes.'],
};

async function fixture(database: ReturnType<typeof createDatabase>) {
  const guest = await database.guestSession.create({
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
  const record = await database.recording.create({
    data: {
      guestSessionId: guest.id,
      expiresAt: guest.expiresAt,
      status: 'COMPLETED',
      originalFilename: 'summary-test.ogg',
      objectKey: `summary-test/${randomUUID()}`,
      mimeType: 'audio/ogg',
      sizeBytes: 12,
      transcript: {
        create: {
          segments: {
            create: [
              {
                sequence: 1,
                startMs: 1000,
                endMs: 2000,
                text: 'Sam will prepare notes.',
              },
              {
                sequence: 0,
                startMs: 0,
                endMs: 1000,
                text: 'We will release on Friday.',
              },
            ],
          },
        },
      },
    },
    include: { transcript: { include: { segments: true } } },
  });
  return { guest, record };
}

test(
  'summary HTTP flow authorizes access, stores separate results, regenerates and isolates failures',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const database = createDatabase();
    const { guest, record } = await fixture(database);
    let failing = false;
    let calls = 0;
    const seen: string[] = [];
    const runtime = createServer(async (request, response) => {
      calls++;
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const payload = JSON.parse(body);
      assert.equal(request.url, '/api/chat');
      assert.equal(payload.stream, false);
      seen.push(payload.messages[1].content);
      if (failing) {
        response.writeHead(500);
        response.end('Synthetic private runtime details');
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          done: true,
          message: {
            content: JSON.stringify({
              ...output,
              text: `${output.text} Version ${calls}.`,
            }),
          },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      runtime.listen(0, '127.0.0.1', resolve),
    );
    const address = runtime.address() as { port: number };
    const previous = {
      model: process.env.SONAVRA_SUMMARY_MODEL,
      url: process.env.SONAVRA_SUMMARY_URL,
    };
    process.env.SONAVRA_SUMMARY_MODEL = 'synthetic-local-model';
    process.env.SONAVRA_SUMMARY_URL = `http://127.0.0.1:${address.port}`;
    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create(AppModule, { logger: false });
    const email = `summary-${randomUUID()}@example.com`;
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const path = `/recordings/${record.id}/summary`;
      const get = (suffix = '', cookie = '') =>
        fetch(`${origin}${path}${suffix}`, { headers: { cookie } });
      const post = (
        guestSessionId: string | undefined,
        cookie = '',
        source = authOrigin(),
      ) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: {
            origin: source,
            cookie,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ guestSessionId }),
        });
      assert.equal((await get()).status, 404);
      assert.equal((await post(randomUUID())).status, 404);
      assert.equal(calls, 0);
      assert.equal(
        (await post(guest.id, '', 'https://untrusted.example')).status,
        403,
      );
      const initial = await get(`?guestSessionId=${guest.id}`);
      assert.equal(initial.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await initial.json(), {
        available: true,
        summary: null,
      });
      const generated = await post(guest.id);
      assert.equal(generated.status, 201);
      const first = (await generated.json()) as {
        summary: { text: string; stale: boolean };
      };
      assert.equal(first.summary.stale, false);
      assert.equal(
        seen[0],
        'Speaker: We will release on Friday.\nSpeaker: Sam will prepare notes.',
      );
      assert.equal(
        (
          await database.transcriptSegment.findUniqueOrThrow({
            where: { id: record.transcript!.segments[0]!.id },
          })
        ).text,
        record.transcript!.segments[0]!.text,
      );
      assert.equal(
        await database.transcriptSummary.count({
          where: { transcriptId: record.transcript!.id },
        }),
        1,
      );
      failing = true;
      const failed = await post(guest.id);
      assert.equal(failed.status, 503);
      assert.doesNotMatch(await failed.text(), /private runtime details/);
      assert.equal(
        (
          (await (
            await get(`?guestSessionId=${guest.id}`)
          ).json()) as typeof first
        ).summary.text,
        first.summary.text,
      );
      assert.equal(
        (
          await fetch(
            `${origin}/recordings/${record.id}/transcript?guestSessionId=${guest.id}`,
          )
        ).status,
        200,
      );
      failing = false;
      await database.transcriptSegment.update({
        where: { id: record.transcript!.segments[0]!.id },
        data: { text: 'Sam will prepare updated notes.' },
      });
      assert.equal(
        (
          (await (
            await get(`?guestSessionId=${guest.id}`)
          ).json()) as typeof first
        ).summary.stale,
        true,
      );
      const regenerated = await post(guest.id);
      assert.equal(regenerated.status, 201);
      const next = (await regenerated.json()) as typeof first;
      assert.notEqual(next.summary.text, first.summary.text);
      assert.equal(next.summary.stale, false);
      assert.equal(
        await database.transcriptSummary.count({
          where: { transcriptId: record.transcript!.id },
        }),
        1,
      );
      await database.recording.update({
        where: { id: record.id },
        data: { status: 'PROCESSING' },
      });
      assert.equal((await post(guest.id)).status, 409);
      await database.recording.update({
        where: { id: record.id },
        data: { status: 'COMPLETED' },
      });
      const signup = await fetch(`${origin}/auth/signup`, {
        method: 'POST',
        headers: { origin: authOrigin(), 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'synthetic summary password',
          guestSessionId: guest.id,
        }),
      });
      assert.equal(signup.status, 201);
      const cookie = signup.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal((await get(`?guestSessionId=${guest.id}`)).status, 404);
      assert.equal((await get('', cookie)).status, 200);
      assert.equal((await post(undefined, cookie)).status, 201);
      await database.recording.delete({ where: { id: record.id } });
      assert.equal(
        await database.transcriptSummary.count({
          where: { transcriptId: record.transcript!.id },
        }),
        0,
      );
    } finally {
      await app.close();
      await new Promise<void>((resolve, reject) =>
        runtime.close((error) => (error ? reject(error) : resolve())),
      );
      if (previous.model === undefined)
        delete process.env.SONAVRA_SUMMARY_MODEL;
      else process.env.SONAVRA_SUMMARY_MODEL = previous.model;
      if (previous.url === undefined) delete process.env.SONAVRA_SUMMARY_URL;
      else process.env.SONAVRA_SUMMARY_URL = previous.url;
      await database.user.deleteMany({ where: { email } });
      await database.guestSession.deleteMany({ where: { id: guest.id } });
      await database.$disconnect();
    }
  },
);

test(
  'generation discards results when edits, ownership, expiry or deletion change during inference',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const database = createDatabase();
    const auth = new AuthService(database);
    const user = await database.user.create({
      data: { email: `summary-race-${randomUUID()}@example.com` },
    });
    try {
      for (const change of [
        'edit',
        'claim',
        'expire',
        'mark',
        'delete',
      ] as const) {
        const { guest, record } = await fixture(database);
        const service = new TranscriptSummaryService(database, {
          available: true,
          generate: async () => {
            if (change === 'edit')
              await database.transcriptSegment.update({
                where: { id: record.transcript!.segments[0]!.id },
                data: { text: 'An edit during generation.' },
              });
            if (change === 'claim')
              assert.equal(
                (await claimGuestRecordings(database, user.id, guest.id))
                  .claimedCount,
                1,
              );
            if (change === 'expire')
              await database.recording.update({
                where: { id: record.id },
                data: { expiresAt: new Date(Date.now() - 1000) },
              });
            if (change === 'mark')
              await database.recording.update({
                where: { id: record.id },
                data: { deletionRequestedAt: new Date() },
              });
            if (change === 'delete')
              await database.recording.delete({ where: { id: record.id } });
            return { ...output, model: 'test' };
          },
        });
        try {
          await assert.rejects(
            () =>
              service.generate(
                record.id,
                async () =>
                  (await recordingAccess(auth, undefined, guest.id)).where,
              ),
            (error: unknown) =>
              error instanceof SummaryError &&
              error.status === (change === 'edit' ? 409 : 404),
          );
          assert.equal(
            await database.transcriptSummary.count({
              where: { transcriptId: record.transcript!.id },
            }),
            0,
          );
        } finally {
          await database.recording.deleteMany({ where: { id: record.id } });
          await database.guestSession.deleteMany({ where: { id: guest.id } });
        }
      }
    } finally {
      await database.user.delete({ where: { id: user.id } });
      await auth.close();
    }
  },
);
