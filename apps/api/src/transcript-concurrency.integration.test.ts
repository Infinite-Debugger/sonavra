import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@sonavra/database';
import type { TranscriptResponse } from '@sonavra/types';

it(
  'rejects concurrent stale text and speaker edits without changing saved content or summary freshness',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const database = createDatabase();
    const guest = await database.guestSession.create({
      data: { expiresAt: new Date(Date.now() + 3600_000) },
    });
    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      const record = await database.recording.create({
        data: {
          guestSessionId: guest.id,
          expiresAt: guest.expiresAt,
          objectKey: `recordings/${randomUUID()}`,
          originalFilename: 'synthetic.ogg',
          sizeBytes: 1,
          mimeType: 'audio/ogg',
          status: 'COMPLETED',
          transcript: {
            create: {
              speakers: { create: { label: 'Speaker 1' } },
              segments: {
                create: {
                  sequence: 0,
                  startMs: 0,
                  endMs: 1000,
                  text: 'Original words.',
                },
              },
            },
          },
        },
        include: {
          transcript: { include: { speakers: true, segments: true } },
        },
      });
      const transcript = record.transcript!;
      const segment = transcript.segments[0]!;
      const speaker = transcript.speakers[0]!;
      await database.transcriptSegment.update({
        where: { id: segment.id },
        data: { speakerId: speaker.id },
      });
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const base = `${origin}/recordings/${record.id}`;
      const read = async () =>
        (await (
          await fetch(`${base}/transcript?guestSessionId=${guest.id}`)
        ).json()) as TranscriptResponse;
      const patch = (kind: string, id: string, body: object) =>
        fetch(`${base}/transcript/${kind}/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ guestSessionId: guest.id, ...body }),
        });
      const first = await read();
      const second = await read();
      assert.equal(first.revision, second.revision);
      const responses = await Promise.all([
        patch('segments', segment.id, {
          text: 'First client.',
          revision: first.revision,
        }),
        patch('segments', segment.id, {
          text: 'Second client.',
          revision: second.revision,
        }),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [200, 409],
      );
      const accepted = (await responses
        .find((response) => response.status === 200)!
        .json()) as { revision: string; text: string };
      const current = await read();
      assert.equal(current.revision, accepted.revision);
      assert.notEqual(current.revision, first.revision);
      assert.equal(current.segments[0]?.text, accepted.text);
      await database.transcriptSummary.create({
        data: {
          transcriptId: transcript.id,
          text: 'Synthetic summary',
          keyPoints: [],
          actionItems: [],
          model: 'test',
          sourceHash: createHash('sha256')
            .update(`Speaker 1: ${accepted.text}`)
            .digest('hex'),
        },
      });
      const summary = async () =>
        (await (
          await fetch(`${base}/summary?guestSessionId=${guest.id}`)
        ).json()) as { summary: { stale: boolean } };
      assert.equal((await summary()).summary.stale, false);
      assert.equal(
        (
          await patch('speakers', speaker.id, {
            displayName: 'Stale client',
            revision: first.revision,
          })
        ).status,
        409,
      );
      assert.equal((await summary()).summary.stale, false);
      assert.equal(
        (await patch('segments', segment.id, { text: 'Missing version' }))
          .status,
        428,
      );
      assert.equal(
        (
          await patch('segments', segment.id, {
            text: 'Bad version',
            revision: 0,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await patch('segments', randomUUID(), {
            text: 'Wrong field',
            revision: current.revision,
          })
        ).status,
        404,
      );
      assert.equal((await read()).revision, current.revision);
      assert.equal(
        (
          await patch('speakers', speaker.id, {
            displayName: '  Ada  ',
            revision: current.revision,
          })
        ).status,
        200,
      );
      assert.equal((await summary()).summary.stale, true);
      const renamed = await read();
      assert.equal(renamed.speakers[0]?.displayName, 'Ada');
      assert.notEqual(renamed.revision, current.revision);
      assert.equal(
        (
          await patch('segments', segment.id, {
            text: 'Old pending edit',
            revision: current.revision,
          })
        ).status,
        409,
      );
      assert.equal((await read()).segments[0]?.text, accepted.text);
      assert.equal(
        (
          await patch('segments', segment.id, {
            text: 'Explicitly reapplied',
            revision: renamed.revision,
          })
        ).status,
        200,
      );
      assert.equal((await read()).segments[0]?.text, 'Explicitly reapplied');
      const beforeReplacement = await read();
      await database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Recording" WHERE "id" = ${record.id}::uuid FOR UPDATE`;
        await tx.transcript.delete({ where: { recordingId: record.id } });
        await tx.transcript.create({
          data: {
            recordingId: record.id,
            segments: {
              create: {
                sequence: 0,
                startMs: 0,
                endMs: 1000,
                text: 'Replacement transcript.',
              },
            },
          },
        });
      });
      assert.notEqual((await read()).revision, beforeReplacement.revision);
      assert.equal(
        (
          await patch('segments', segment.id, {
            text: 'Old field',
            revision: beforeReplacement.revision,
          })
        ).status,
        409,
      );
      assert.equal((await read()).segments[0]?.text, 'Replacement transcript.');
      await database.recording.update({
        where: { id: record.id },
        data: { deletionRequestedAt: new Date() },
      });
      assert.equal(
        (
          await patch('segments', segment.id, {
            text: 'Deleted',
            revision: (
              await database.transcript.findUniqueOrThrow({
                where: { recordingId: record.id },
              })
            ).revision,
          })
        ).status,
        404,
      );
    } finally {
      await app.close();
      await database.guestSession.delete({ where: { id: guest.id } });
      await database.$disconnect();
    }
  },
);
