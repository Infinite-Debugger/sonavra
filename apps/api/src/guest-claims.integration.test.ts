import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@sonavra/database';
import { authOrigin } from './auth.js';

describe(
  'guest claims and recording authorization',
  { skip: !process.env.DATABASE_URL },
  () => {
    it('claims eligible work atomically and keeps account-owned media and transcripts private', async () => {
      const database = createDatabase();
      const marker = randomUUID();
      const emails = [
        `claim-a-${marker}@example.com`,
        `claim-b-${marker}@example.com`,
      ];
      const password = 'claim integration password';
      const guests: string[] = [];
      const future = new Date(Date.now() + 86400000);
      const past = new Date(Date.now() - 60000);
      const createGuest = async (expiresAt = future) => {
        const guest = await database.guestSession.create({
          data: { expiresAt },
        });
        guests.push(guest.id);
        return guest.id;
      };
      const createRecording = (
        guestSessionId: string,
        status: 'COMPLETED' | 'PROCESSING' | 'UPLOADING',
        expiresAt = future,
      ) =>
        database.recording.create({
          data: {
            guestSessionId,
            status,
            expiresAt,
            originalFilename: 'claim-test.ogg',
            objectKey: `claim-test/${randomUUID()}`,
            mimeType: 'audio/ogg',
            sizeBytes: 12,
          },
        });
      const { AppModule } = await import('./app.module.js');
      const app = await NestFactory.create(AppModule, { logger: false });
      try {
        await app.listen(0, '127.0.0.1');
        const url = await app.getUrl();
        const request = (
          path: string,
          cookie = '',
          body?: unknown,
          method = 'POST',
          origin = authOrigin(),
        ) =>
          fetch(`${url}${path}`, {
            method: body === undefined ? 'GET' : method,
            headers: { cookie, origin, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        const guestA = await createGuest();
        const guestB = await createGuest();
        const completed = await createRecording(guestA, 'COMPLETED');
        const processing = await createRecording(guestA, 'PROCESSING');
        const uploading = await createRecording(guestA, 'UPLOADING');
        const expired = await createRecording(guestA, 'COMPLETED', past);
        const foreign = await createRecording(guestB, 'COMPLETED');
        const transcript = await database.transcript.create({
          data: {
            recordingId: completed.id,
            segments: {
              create: {
                sequence: 0,
                startMs: 0,
                endMs: 1000,
                text: 'Synthetic transcript.',
              },
            },
            speakers: { create: { label: 'Speaker 1' } },
          },
          include: { segments: true, speakers: true },
        });
        const job = await database.transcriptionJob.create({
          data: { recordingId: completed.id, status: 'COMPLETED' },
        });

        assert.equal(
          (await request('/auth/claim', '', { guestSessionId: guestA })).status,
          401,
        );
        assert.equal(
          (
            await request(
              `/recordings/${foreign.id}/status?guestSessionId=${guestA}`,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/recordings/${completed.id}/status?guestSessionId=${guestA}`,
            )
          ).status,
          200,
        );
        const signupA = await request('/auth/signup', '', {
          email: emails[0],
          password,
          guestSessionId: guestA,
        });
        assert.equal(signupA.status, 201);
        const cookieA = signupA.headers.get('set-cookie')!.split(';')[0]!;
        const resultA = (await signupA.json()) as {
          user: { id: string };
          claimedCount: number;
        };
        assert.equal(resultA.claimedCount, 2);
        for (const id of [completed.id, processing.id]) {
          const record = await database.recording.findUniqueOrThrow({
            where: { id },
          });
          assert.equal(record.userId, resultA.user.id);
          assert.equal(record.guestSessionId, null);
          assert.equal(record.expiresAt, null);
        }
        for (const id of [uploading.id, expired.id]) {
          const record = await database.recording.findUniqueOrThrow({
            where: { id },
          });
          assert.equal(record.userId, null);
          assert.equal(record.guestSessionId, guestA);
        }
        assert.equal(
          (
            await database.recording.findUniqueOrThrow({
              where: { id: foreign.id },
            })
          ).userId,
          null,
        );
        assert.deepEqual(
          await (
            await request('/auth/claim', cookieA, { guestSessionId: guestA })
          ).json(),
          { claimedCount: 0 },
        );
        assert.equal((await request('/auth/claim', cookieA, {})).status, 400);
        assert.equal(
          (await request('/auth/claim', cookieA, { guestSessionId: 'invalid' }))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              '/auth/claim',
              cookieA,
              { guestSessionId: guestA },
              'POST',
              'https://untrusted.example',
            )
          ).status,
          403,
        );

        const signupB = await request('/auth/signup', '', {
          email: emails[1],
          password,
        });
        const cookieB = signupB.headers.get('set-cookie')!.split(';')[0]!;
        const { user: userB } = (await signupB.json()) as {
          user: { id: string };
        };
        for (const path of [
          `/recordings/${completed.id}/status`,
          `/recordings/${completed.id}/transcript`,
          `/transcription-jobs/${job.id}`,
        ]) {
          assert.equal(
            (await request(`${path}?guestSessionId=${guestA}`)).status,
            404,
          );
          assert.equal(
            (await request(`${path}?guestSessionId=${guestA}`, cookieB)).status,
            404,
          );
          assert.equal((await request(path, cookieA)).status, 200);
        }
        const status = (await (
          await request(`/recordings/${completed.id}/status`, cookieA)
        ).json()) as { ownership: string; canClaim: boolean };
        assert.equal(status.ownership, 'account');
        assert.equal(status.canClaim, false);
        const segmentPath = `/recordings/${completed.id}/transcript/segments/${transcript.segments[0]!.id}`;
        const speakerPath = `/recordings/${completed.id}/transcript/speakers/${transcript.speakers[0]!.id}`;
        for (const cookie of ['', cookieB]) {
          assert.equal(
            (
              await request(
                segmentPath,
                cookie,
                { guestSessionId: guestA, text: 'Unauthorized edit.' },
                'PATCH',
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                speakerPath,
                cookie,
                { guestSessionId: guestA, displayName: 'Unauthorized speaker' },
                'PATCH',
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/recordings/${processing.id}/transcription-jobs`,
                cookie,
                { guestSessionId: guestA },
              )
            ).status,
            404,
          );
        }
        assert.equal(
          (
            await request(
              segmentPath,
              cookieA,
              { text: 'Owned edit.' },
              'PATCH',
              'https://untrusted.example',
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              segmentPath,
              cookieA,
              { text: 'Owned edit.' },
              'PATCH',
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              speakerPath,
              cookieA,
              { displayName: 'Owned speaker' },
              'PATCH',
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              `/recordings/${processing.id}/transcription-jobs`,
              cookieA,
              {},
            )
          ).status,
          202,
        );
        assert.equal(
          (
            await database.transcript.findUniqueOrThrow({
              where: { recordingId: completed.id },
            })
          ).id,
          transcript.id,
        );

        // The client cannot choose a target user or a foreign recording outside its guest credential.
        const attempts = await Promise.all([
          request('/auth/claim', cookieB, {
            guestSessionId: guestB,
            userId: resultA.user.id,
            recordingId: completed.id,
          }),
          request('/auth/claim', cookieB, { guestSessionId: guestB }),
        ]);
        const results = await Promise.all(
          attempts.map(
            (response) => response.json() as Promise<{ claimedCount: number }>,
          ),
        );
        assert.equal(
          results.reduce((sum, result) => sum + result.claimedCount, 0),
          1,
        );
        assert.equal(
          (
            await database.recording.findUniqueOrThrow({
              where: { id: foreign.id },
            })
          ).userId,
          userB.id,
        );
        assert.equal(
          (
            await database.recording.findUniqueOrThrow({
              where: { id: completed.id },
            })
          ).userId,
          resultA.user.id,
        );

        const expiredGuest = await createGuest(past);
        const expiredSessionRecording = await createRecording(
          expiredGuest,
          'COMPLETED',
        );
        assert.deepEqual(
          await (
            await request('/auth/claim', cookieB, {
              guestSessionId: expiredGuest,
            })
          ).json(),
          { claimedCount: 0 },
        );
        assert.equal(
          (
            await database.recording.findUniqueOrThrow({
              where: { id: expiredSessionRecording.id },
            })
          ).userId,
          null,
        );
        assert.deepEqual(
          await (
            await request('/auth/claim', cookieB, {
              guestSessionId: randomUUID(),
            })
          ).json(),
          { claimedCount: 0 },
        );

        await database.guestSession.delete({ where: { id: guestA } });
        assert.equal(
          (await request(`/recordings/${completed.id}/transcript`, cookieA))
            .status,
          200,
        );
        await request('/auth/signout', cookieA, {});
        assert.equal(
          (await request(`/recordings/${completed.id}/transcript`, cookieA))
            .status,
          404,
        );
      } finally {
        await app.close();
        await database.user.deleteMany({ where: { email: { in: emails } } });
        await database.guestSession.deleteMany({
          where: { id: { in: guests } },
        });
        await database.$disconnect();
      }
    });
  },
);
