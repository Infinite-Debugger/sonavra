import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createDatabase, type PrismaClient } from '@sonavra/database';
import type { ObjectStorage } from '@sonavra/storage';
import type {
  NormalizedMedia,
  TranscriptionEngine,
  TranscriptionRequest,
  TranscriptionResult,
} from '@sonavra/transcription';

import { TranscriptionJobProcessor } from './transcription-jobs.js';

let database: PrismaClient;
let guestSessionId: string;
const testDatabase = `worker_test_${randomBytes(8).toString('hex')}`;
let admin: PrismaClient;
let testDatabaseCreated = false;

const storage: ObjectStorage = {
  createObjectKey: () => 'recordings/test/source',
  presignUpload: async () => {
    throw new Error('unused');
  },
  presignDownload: async () => {
    throw new Error('unused');
  },
  statObject: async () => null,
  downloadObject: async () => new Response(Buffer.from('media')),
  deleteObject: async () => undefined,
};

const preprocessor = {
  normalize: async (): Promise<NormalizedMedia> => ({
    path: '/tmp/normalized.wav',
    sampleRate: 16000,
    channels: 1,
    dispose: async () => undefined,
  }),
};

class Engine implements TranscriptionEngine {
  readonly name = 'test-self-hosted';
  constructor(private readonly result: TranscriptionResult | Error) {}
  async transcribe(request: TranscriptionRequest) {
    void request;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const result: TranscriptionResult = {
  engine: 'test-self-hosted',
  language: 'en',
  durationMs: 1200,
  speakers: [{ id: 'speaker-1', label: 'Speaker 1' }],
  segments: [
    {
      startMs: 0,
      endMs: 1200,
      text: 'Hello Sonavra',
      speakerId: 'speaker-1',
    },
  ],
};

async function recording() {
  return database.recording.create({
    data: {
      guestSessionId,
      originalFilename: 'source.ogg',
      objectKey: 'recordings/test/source',
      mimeType: 'audio/ogg',
      sizeBytes: 5,
    },
  });
}

before(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  admin = createDatabase(url.toString());
  await admin.$executeRawUnsafe(`CREATE DATABASE "${testDatabase}"`);
  testDatabaseCreated = true;
  url.pathname = `/${testDatabase}`;
  url.searchParams.set('schema', 'public');
  execFileSync(
    'pnpm',
    ['--filter', '@sonavra/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  );
  database = createDatabase(url.toString());
  const guest = await database.guestSession.create({
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
  guestSessionId = guest.id;
});

beforeEach(async () => {
  await database.transcriptSegment.deleteMany();
  await database.speaker.deleteMany();
  await database.transcript.deleteMany();
  await database.transcriptionJob.deleteMany();
  await database.recording.deleteMany();
});

after(async () => {
  if (database) await database.$disconnect();
  if (testDatabaseCreated)
    await admin.$executeRawUnsafe(
      `DROP DATABASE "${testDatabase}" WITH (FORCE)`,
    );
  if (admin) await admin.$disconnect();
});

test('does not persist a result after a recording is deleted during transcription', async () => {
  const source = await recording();
  const engine: TranscriptionEngine = {
    name: 'deletion-test',
    transcribe: async () => {
      await database.recording.update({
        where: { id: source.id },
        data: { deletionRequestedAt: new Date() },
      });
      await database.recording.delete({ where: { id: source.id } });
      return result;
    },
  };
  const processor = new TranscriptionJobProcessor(
    database,
    storage,
    preprocessor,
    engine,
  );
  await processor.enqueue(source.id);
  assert.equal(await processor.processNext(), true);
  assert.equal(await database.transcript.count(), 0);
  assert.equal(await database.transcriptionJob.count(), 0);
});

test('does not retry a job after deletion is requested during transcription', async () => {
  const source = await recording();
  const engine: TranscriptionEngine = {
    name: 'deletion-test',
    transcribe: async () => {
      await database.recording.update({
        where: { id: source.id },
        data: { deletionRequestedAt: new Date() },
      });
      throw new Error('Synthetic engine failure');
    },
  };
  const processor = new TranscriptionJobProcessor(
    database,
    storage,
    preprocessor,
    engine,
  );
  await processor.enqueue(source.id);
  assert.equal(await processor.processNext(), true);
  assert.equal(await processor.processNext(), false);
  assert.equal(await database.transcript.count(), 0);
});

test('processes a queued job and persists normalized transcript data', async () => {
  const source = await recording();
  const processor = new TranscriptionJobProcessor(
    database,
    storage,
    preprocessor,
    new Engine(result),
    { retryDelayMs: 0 },
  );
  const job = await processor.enqueue(source.id);

  assert.equal(await processor.processNext(), true);

  const persisted = await database.transcriptionJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(persisted.status, 'COMPLETED');
  assert.equal(persisted.attemptCount, 1);
  const transcript = await database.transcript.findUniqueOrThrow({
    where: { recordingId: source.id },
    include: { speakers: true, segments: true },
  });
  assert.equal(transcript.language, 'en');
  assert.equal(transcript.speakers[0]?.label, 'Speaker 1');
  assert.equal(transcript.segments[0]?.text, 'Hello Sonavra');
  assert.equal(transcript.segments[0]?.speakerId, transcript.speakers[0]?.id);
});

test('requeues retryable failures and succeeds on a later attempt', async () => {
  const source = await recording();
  let calls = 0;
  const engine: TranscriptionEngine = {
    name: 'flaky-local',
    async transcribe() {
      calls += 1;
      if (calls === 1) {
        const { TranscriptionEngineError } =
          await import('@sonavra/transcription');
        throw new TranscriptionEngineError('temporary local failure', {
          code: 'resource_exhausted',
          retryable: true,
          engine: 'flaky-local',
        });
      }
      return result;
    },
  };
  const processor = new TranscriptionJobProcessor(
    database,
    storage,
    preprocessor,
    engine,
    { retryDelayMs: 0 },
  );
  const job = await processor.enqueue(source.id);

  await processor.processNext();
  let persisted = await database.transcriptionJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(persisted.status, 'QUEUED');
  assert.equal(persisted.retryable, true);

  await processor.processNext();
  persisted = await database.transcriptionJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(persisted.status, 'COMPLETED');
  assert.equal(persisted.attemptCount, 2);
});

test('persists terminal failures without retrying non-retryable errors', async () => {
  const { TranscriptionEngineError } = await import('@sonavra/transcription');
  const source = await recording();
  const processor = new TranscriptionJobProcessor(
    database,
    storage,
    preprocessor,
    new Engine(
      new TranscriptionEngineError('model missing', {
        code: 'model_unavailable',
        retryable: false,
        engine: 'test-self-hosted',
      }),
    ),
  );
  const job = await processor.enqueue(source.id);

  await processor.processNext();
  const persisted = await database.transcriptionJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(persisted.status, 'FAILED');
  assert.equal(persisted.retryable, false);
  assert.equal(persisted.errorCode, 'model_unavailable');
});

test('reclaims an expired processing lease after worker restart', async () => {
  const source = await recording();
  const job = await database.transcriptionJob.create({
    data: {
      recordingId: source.id,
      status: 'PROCESSING',
      attemptCount: 1,
      startedAt: new Date(Date.now() - 120000),
      leaseExpiresAt: new Date(Date.now() - 1000),
    },
  });
  const restartedWorker = new TranscriptionJobProcessor(
    database,
    storage,
    preprocessor,
    new Engine(result),
  );

  assert.equal(await restartedWorker.processNext(), true);
  const persisted = await database.transcriptionJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(persisted.status, 'COMPLETED');
  assert.equal(persisted.attemptCount, 2);
});

test('guest cleanup deletes expired media and dependent data while preserving claimed and unexpired work', async () => {
  const { GuestCleanup } = await import('./guest-cleanup.js');
  const { createS3ObjectStorageFromEnv } = await import('@sonavra/storage');
  const objectStorage = createS3ObjectStorageFromEnv();
  const upload = await objectStorage.presignUpload('audio/ogg');
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
  const expired = await recording();
  const past = new Date(Date.now() - 1000);
  await database.recording.update({
    where: { id: expired.id },
    data: {
      objectKey: upload.key,
      expiresAt: past,
      transcript: {
        create: {
          speakers: { create: { label: 'Speaker 1' } },
          segments: {
            create: {
              sequence: 0,
              startMs: 0,
              endMs: 1,
              text: 'Synthetic test.',
            },
          },
        },
      },
      transcriptionJobs: { create: { status: 'QUEUED' } },
    },
  });
  const unexpired = await recording();
  await database.recording.update({
    where: { id: unexpired.id },
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
  const user = await database.user.create({
    data: { email: `${randomBytes(8).toString('hex')}@example.com` },
  });
  const claimed = await recording();
  await database.recording.update({
    where: { id: claimed.id },
    data: { userId: user.id, guestSessionId: null, expiresAt: past },
  });
  try {
    const cleanup = new GuestCleanup(database, objectStorage);
    assert.equal((await cleanup.run()).deleted, 1);
    assert.equal(await objectStorage.statObject(upload.key), null);
    assert.equal(
      await database.recording.findUnique({ where: { id: expired.id } }),
      null,
    );
    assert.equal(await database.transcript.count(), 0);
    assert.equal(await database.speaker.count(), 0);
    assert.equal(await database.transcriptSegment.count(), 0);
    assert.equal(await database.transcriptionJob.count(), 0);
    assert.equal(await database.recording.count(), 2);
    assert.equal((await cleanup.run()).deleted, 0);
  } finally {
    await objectStorage.deleteObject(upload.key);
    await database.user.delete({ where: { id: user.id } });
  }
});

test('guest cleanup retains failed media deletions for retry and removes only empty expired sessions', async () => {
  const { GuestCleanup } = await import('./guest-cleanup.js');
  const past = new Date(Date.now() - 1000);
  const guest = await database.guestSession.create({
    data: { expiresAt: past },
  });
  const expired = await database.recording.create({
    data: {
      guestSessionId: guest.id,
      expiresAt: new Date(Date.now() + 3600000),
      originalFilename: 'expired.ogg',
      objectKey: 'recordings/expired/source',
      mimeType: 'audio/ogg',
      sizeBytes: 5,
      status: 'UPLOADING',
    },
  });
  let failing = true;
  const deletedKeys: string[] = [];
  const cleanup = new GuestCleanup(database, {
    ...storage,
    deleteObject: async (key) => {
      if (failing) throw new Error('Synthetic storage failure');
      deletedKeys.push(key);
    },
  });
  assert.equal((await cleanup.run()).failed, 1);
  assert.ok(
    (await database.recording.findUniqueOrThrow({ where: { id: expired.id } }))
      .deletionRequestedAt,
  );
  assert.ok(
    await database.guestSession.findUnique({ where: { id: guest.id } }),
  );
  failing = false;
  assert.equal((await cleanup.run()).deleted, 1);
  assert.deepEqual(deletedKeys, ['recordings/expired/source']);
  assert.equal(
    await database.guestSession.findUnique({ where: { id: guest.id } }),
    null,
  );
});

test('a claim that wins before the cleanup marker protects the media', async () => {
  const { GuestCleanup } = await import('./guest-cleanup.js');
  const source = await recording();
  await database.recording.update({
    where: { id: source.id },
    data: { expiresAt: new Date(Date.now() + 60000) },
  });
  const user = await database.user.create({
    data: { email: `${randomBytes(8).toString('hex')}@example.com` },
  });
  const cleanupDatabase = Object.create(database) as PrismaClient;
  Object.defineProperty(cleanupDatabase, 'recording', {
    value: {
      ...database.recording,
      findMany: async (
        ...args: Parameters<typeof database.recording.findMany>
      ) => {
        const candidates = await database.recording.findMany(...args);
        await database.recording.update({
          where: { id: source.id },
          data: { userId: user.id, guestSessionId: null, expiresAt: null },
        });
        return candidates;
      },
    },
  });
  let mediaDeleted = false;
  try {
    const cleanup = new GuestCleanup(cleanupDatabase, {
      ...storage,
      deleteObject: async () => {
        mediaDeleted = true;
      },
    });
    assert.equal((await cleanup.run(new Date(Date.now() + 120000))).deleted, 0);
    assert.equal(mediaDeleted, false);
    assert.equal(
      (await database.recording.findUniqueOrThrow({ where: { id: source.id } }))
        .userId,
      user.id,
    );
  } finally {
    await database.user.delete({ where: { id: user.id } });
  }
});
