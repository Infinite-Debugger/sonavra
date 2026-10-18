import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';
import { authOrigin } from './auth.js';
import { LibraryService } from './library.js';

it(
  'isolates history, persists titles, and deletes media and associated data with recoverable failures',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const database = createDatabase();
    const storage = createS3ObjectStorageFromEnv();
    const marker = randomUUID();
    const emails = [
      `library-a-${marker}@example.com`,
      `library-b-${marker}@example.com`,
    ];
    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create(AppModule, { logger: false });
    let key: string | undefined;
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const request = (
        path: string,
        cookie = '',
        body?: unknown,
        method = 'POST',
        source = authOrigin(),
      ) =>
        fetch(`${origin}${path}`, {
          method: body === undefined ? 'GET' : method,
          headers: {
            cookie,
            origin: source,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      const signup = async (email: string) => {
        const response = await request('/auth/signup', '', {
          email,
          password: 'library test password',
        });
        assert.equal(response.status, 201);
        return {
          cookie: response.headers.get('set-cookie')!.split(';')[0]!,
          user: ((await response.json()) as { user: { id: string } }).user,
        };
      };
      const owner = await signup(emails[0]!);
      const other = await signup(emails[1]!);
      const upload = await storage.presignUpload('audio/ogg');
      key = upload.key;
      assert.equal(
        (
          await fetch(upload.url, {
            method: upload.method,
            headers: upload.headers,
            body: 'synthetic media',
          })
        ).ok,
        true,
      );
      const record = await database.recording.create({
        data: {
          userId: owner.user.id,
          originalFilename: 'meeting.ogg',
          objectKey: key,
          mimeType: 'audio/ogg',
          sizeBytes: 15,
          status: 'COMPLETED',
          transcript: {
            create: {
              speakers: { create: { label: 'Speaker 1' } },
              segments: {
                create: {
                  sequence: 0,
                  startMs: 0,
                  endMs: 1000,
                  text: 'Synthetic library transcript.',
                },
              },
            },
          },
          transcriptionJobs: { create: { status: 'COMPLETED' } },
        },
      });
      await database.recording.createMany({
        data: Array.from({ length: 26 }, (_, i) => ({
          userId: owner.user.id,
          originalFilename: `fixture-${i}.ogg`,
          objectKey: `fixture/${marker}/${i}`,
          mimeType: 'audio/ogg',
          sizeBytes: 1,
          status: i % 2 ? 'QUEUED' : 'FAILED',
        })),
      });
      const foreign = await database.recording.create({
        data: {
          userId: other.user.id,
          originalFilename: 'foreign.ogg',
          objectKey: `foreign/${marker}`,
          mimeType: 'audio/ogg',
          sizeBytes: 1,
        },
      });
      assert.equal((await request('/library/recordings')).status, 401);
      const list = await request('/library/recordings', owner.cookie);
      assert.equal(list.headers.get('cache-control'), 'no-store');
      const history = (await list.json()) as {
        items: Array<{ id: string }>;
        total: number;
        hasMore: boolean;
      };
      assert.equal(history.total, 27);
      assert.equal(history.items.length, 25);
      assert.equal(history.hasMore, true);
      assert.equal(
        history.items.some((item) => item.id === foreign.id),
        false,
      );
      assert.equal(
        (
          await (
            await request('/library/recordings?page=2', owner.cookie)
          ).json()
        ).items.length,
        2,
      );
      assert.equal(
        (await request('/library/recordings?page=0', owner.cookie)).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/library/recordings/${record.id}`,
            other.cookie,
            { title: 'Unauthorized' },
            'PATCH',
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/library/recordings/${record.id}`,
            owner.cookie,
            { title: 'Notes' },
            'PATCH',
            'https://untrusted.example',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/library/recordings/${record.id}`,
            owner.cookie,
            { title: '' },
            'PATCH',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/library/recordings/${record.id}`,
            owner.cookie,
            { title: 'Planning notes' },
            'PATCH',
          )
        ).status,
        200,
      );
      const search = await (
        await request('/library/recordings?q=PLANNING', owner.cookie)
      ).json();
      assert.equal(search.items.length, 1);
      assert.equal(search.items[0].title, 'Planning notes');
      assert.equal(
        (
          await (
            await request('/library/recordings?q=meeting', owner.cookie)
          ).json()
        ).items.length,
        1,
      );
      assert.equal(
        (
          await (
            await request(`/recordings/${record.id}/transcript`, owner.cookie)
          ).json()
        ).title,
        'Planning notes',
      );
      assert.equal(
        (
          await request(
            `/library/recordings/${record.id}`,
            other.cookie,
            {},
            'DELETE',
          )
        ).status,
        404,
      );
      const failing = new LibraryService(database, {
        ...storage,
        createObjectKey: storage.createObjectKey.bind(storage),
        presignUpload: storage.presignUpload.bind(storage),
        presignDownload: storage.presignDownload.bind(storage),
        statObject: storage.statObject.bind(storage),
        downloadObject: storage.downloadObject.bind(storage),
        deleteObject: async () => {
          throw new Error('Synthetic storage failure');
        },
      });
      await assert.rejects(
        () => failing.remove(owner.user.id, record.id),
        /cleanup failed/,
      );
      assert.equal(
        (await request(`/recordings/${record.id}/transcript`, owner.cookie))
          .status,
        404,
      );
      assert.equal(
        (
          await (
            await request('/library/recordings?q=Planning', owner.cookie)
          ).json()
        ).items[0].deletionPending,
        true,
      );
      assert.equal(
        (
          await request(
            `/library/recordings/${record.id}`,
            owner.cookie,
            {},
            'DELETE',
          )
        ).status,
        200,
      );
      assert.equal(await storage.statObject(key), null);
      assert.equal(
        await database.recording.findUnique({ where: { id: record.id } }),
        null,
      );
      assert.equal(
        await database.transcript.count({ where: { recordingId: record.id } }),
        0,
      );
      assert.equal(
        await database.transcriptionJob.count({
          where: { recordingId: record.id },
        }),
        0,
      );
      assert.notEqual(
        await database.recording.findUnique({ where: { id: foreign.id } }),
        null,
      );
    } finally {
      await app.close();
      await database.user.deleteMany({ where: { email: { in: emails } } });
      if (key) await storage.deleteObject(key);
      await database.$disconnect();
    }
  },
);
