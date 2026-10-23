import { PrismaClient } from '@prisma/client';

export { PrismaClient } from '@prisma/client';

export function createDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

export async function createQueuedTranscriptionJob(
  database: Pick<PrismaClient, '$queryRaw' | 'transcriptionJob'>,
  recordingId: string,
) {
  // Keep scheduling on PostgreSQL's clock even when the ORM evaluates defaults locally.
  const [clock] = await database.$queryRaw<
    Array<{ now: Date }>
  >`SELECT NOW() AS now`;
  return database.transcriptionJob.create({
    data: { recordingId, status: 'QUEUED', availableAt: clock!.now },
  });
}
