import { createDatabase, type PrismaClient } from '@sonavra/database';
import {
  createS3ObjectStorageFromEnv,
  type ObjectStorage,
} from '@sonavra/storage';
import type { LibraryResponse } from '@sonavra/types';

export class LibraryError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function recordingTitle(body: unknown) {
  const title =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).title
      : undefined;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200)
    throw new LibraryError('Use a title between 1 and 200 characters.');
  return title.trim();
}

export function libraryQuery(search = '', page = '1') {
  if (
    typeof search !== 'string' ||
    search.length > 200 ||
    !/^[1-9]\d{0,5}$/.test(page)
  )
    throw new LibraryError('Invalid library search or page.');
  return { search: search.trim(), page: Number(page) };
}

function validId(id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw new LibraryError('Recording not found.', 404);
}

export class LibraryService {
  constructor(
    readonly database: PrismaClient = createDatabase(),
    private readonly storage: ObjectStorage = createS3ObjectStorageFromEnv(),
  ) {}

  async list(
    userId: string,
    search: string,
    page: number,
  ): Promise<LibraryResponse> {
    const where = {
      userId,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              {
                originalFilename: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const [records, total] = await this.database.$transaction([
      this.database.recording.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.database.recording.count({ where }),
    ]);
    return {
      items: records.map((record) => ({
        id: record.id,
        title: record.title ?? record.originalFilename,
        originalFilename: record.originalFilename,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
        deletionPending: Boolean(record.deletionRequestedAt),
      })),
      total,
      page,
      hasMore: page * 25 < total,
    };
  }

  async rename(userId: string, id: string, body: unknown) {
    validId(id);
    const title = recordingTitle(body);
    const result = await this.database.recording.updateMany({
      where: { id, userId, deletionRequestedAt: null },
      data: { title },
    });
    if (!result.count) throw new LibraryError('Recording not found.', 404);
    return { id, title };
  }

  async remove(userId: string, id: string) {
    validId(id);
    const record = await this.database.recording.findFirst({
      where: { id, userId },
    });
    if (!record) throw new LibraryError('Recording not found.', 404);
    await this.database.recording.updateMany({
      where: { id, userId },
      data: { deletionRequestedAt: new Date() },
    });
    try {
      await this.storage.deleteObject(record.objectKey);
    } catch {
      throw new LibraryError(
        'Media cleanup failed. Retry deletion to finish removing this recording.',
        503,
      );
    }
    await this.database.recording.deleteMany({ where: { id, userId } });
    return { id };
  }
}
