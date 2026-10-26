import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@sonavra/database';
import type {
  RecordingMediaResponse,
  TranscriptResponse,
} from '@sonavra/types';
import { authOrigin } from './auth.js';

it(
  'renews private media only for current owners and bounds guest authorization by both deadlines',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const database = createDatabase();
    const marker = randomUUID();
    const emails = [
      `media-a-${marker}@example.com`,
      `media-b-${marker}@example.com`,
    ];
    const guests: string[] = [];
    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const signup = async (email: string) => {
        const response = await fetch(`${origin}/auth/signup`, {
          method: 'POST',
          headers: { origin: authOrigin(), 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'media test password' }),
        });
        assert.equal(response.status, 201);
        return {
          cookie: response.headers.get('set-cookie')!.split(';')[0]!,
          userId: ((await response.json()) as { user: { id: string } }).user.id,
        };
      };
      const owner = await signup(emails[0]!);
      const other = await signup(emails[1]!);
      const guest = await database.guestSession.create({
        data: { expiresAt: new Date(Date.now() + 120_000) },
      });
      guests.push(guest.id);
      const foreignGuest = await database.guestSession.create({
        data: { expiresAt: new Date(Date.now() + 3600_000) },
      });
      guests.push(foreignGuest.id);
      const guestRecording = await database.recording.create({
        data: {
          guestSessionId: guest.id,
          expiresAt: new Date(Date.now() + 180_000),
          originalFilename: 'synthetic.ogg',
          objectKey: `recordings/${marker}/guest`,
          mimeType: 'audio/ogg',
          sizeBytes: 1,
          status: 'COMPLETED',
          transcript: {
            create: {
              segments: {
                create: {
                  sequence: 0,
                  startMs: 0,
                  endMs: 1000,
                  text: 'Synthetic fixture',
                },
              },
            },
          },
        },
      });
      const accountRecording = await database.recording.create({
        data: {
          userId: owner.userId,
          originalFilename: 'synthetic.mp4',
          objectKey: `recordings/${marker}/account`,
          mimeType: 'video/mp4',
          sizeBytes: 1,
          status: 'COMPLETED',
        },
      });
      const get = (id: string, guestId = '', cookie = '', resource = 'media') =>
        fetch(
          `${origin}/recordings/${id}/${resource}?guestSessionId=${guestId}`,
          { headers: { cookie } },
        );
      const initial = await get(guestRecording.id, guest.id, '', 'transcript');
      assert.equal(initial.status, 200);
      const transcript = (await initial.json()) as TranscriptResponse;
      assert.ok(
        Date.parse(transcript.media.expiresAt) <= guest.expiresAt.getTime(),
      );
      const renewed = await get(guestRecording.id, guest.id);
      assert.equal(renewed.status, 200);
      assert.equal(renewed.headers.get('cache-control'), 'no-store');
      const media = (await renewed.json()) as RecordingMediaResponse;
      assert.deepEqual(Object.keys(media).sort(), [
        'expiresAt',
        'mimeType',
        'url',
      ]);
      assert.equal(media.mimeType, 'audio/ogg');
      assert.ok(Date.parse(media.expiresAt) <= guest.expiresAt.getTime());
      assert.ok(
        Number(new URL(media.url).searchParams.get('X-Amz-Expires')) <= 120,
      );
      assert.equal((await get(guestRecording.id, foreignGuest.id)).status, 404);
      assert.equal(
        (await get(guestRecording.id, '', other.cookie)).status,
        404,
      );
      const deadline = new Date(Date.now() + 60_000);
      await database.recording.update({
        where: { id: guestRecording.id },
        data: { expiresAt: deadline },
      });
      const shortened = (await (
        await get(guestRecording.id, guest.id)
      ).json()) as RecordingMediaResponse;
      assert.ok(Date.parse(shortened.expiresAt) <= deadline.getTime());

      const before = Date.now();
      const account = await get(accountRecording.id, '', owner.cookie);
      assert.equal(account.status, 200);
      const accountMedia = (await account.json()) as RecordingMediaResponse;
      assert.equal(accountMedia.mimeType, 'video/mp4');
      assert.equal(
        new URL(accountMedia.url).searchParams.get('X-Amz-Expires'),
        '3600',
      );
      assert.ok(Date.parse(accountMedia.expiresAt) <= Date.now() + 3600_000);
      assert.ok(Date.parse(accountMedia.expiresAt) >= before + 3599_000);
      assert.equal(
        (await get(accountRecording.id, '', other.cookie)).status,
        404,
      );
      assert.equal((await get(accountRecording.id)).status, 404);

      await database.recording.update({
        where: { id: guestRecording.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await get(guestRecording.id, guest.id)).status, 404);
      await database.recording.update({
        where: { id: guestRecording.id },
        data: { expiresAt: deadline },
      });
      await database.guestSession.update({
        where: { id: guest.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await get(guestRecording.id, guest.id)).status, 404);
      await database.guestSession.update({
        where: { id: guest.id },
        data: { expiresAt: deadline },
      });
      await database.recording.update({
        where: { id: guestRecording.id },
        data: { userId: owner.userId, guestSessionId: null, expiresAt: null },
      });
      assert.equal((await get(guestRecording.id, guest.id)).status, 404);
      assert.equal(
        (await get(guestRecording.id, '', owner.cookie)).status,
        200,
      );
      await database.recording.update({
        where: { id: accountRecording.id },
        data: { deletionRequestedAt: new Date() },
      });
      assert.equal(
        (await get(accountRecording.id, '', owner.cookie)).status,
        404,
      );
      await database.recording.delete({ where: { id: accountRecording.id } });
      assert.equal(
        (await get(accountRecording.id, '', owner.cookie)).status,
        404,
      );
    } finally {
      await app.close();
      await database.user.deleteMany({ where: { email: { in: emails } } });
      await database.guestSession.deleteMany({ where: { id: { in: guests } } });
      await database.$disconnect();
    }
  },
);
