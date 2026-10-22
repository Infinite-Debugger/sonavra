import type { PrismaClient } from '@sonavra/database';
import type { ObjectStorage } from '@sonavra/storage';

export class GuestCleanup {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: ObjectStorage,
  ) {}

  async run(now = new Date()) {
    const expired = {
      userId: null,
      OR: [
        { expiresAt: { lte: now } },
        { guestSession: { expiresAt: { lte: now } } },
      ],
    };
    const candidates = await this.database.recording.findMany({
      where: expired,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, objectKey: true },
    });
    let deleted = 0;
    let failed = 0;
    for (const candidate of candidates) {
      // Compete with ownership transfers atomically before touching media.
      // The marker blocks claims, access and further transcription writes.
      const marked = await this.database.recording.updateMany({
        where: { id: candidate.id, ...expired },
        data: { deletionRequestedAt: now },
      });
      if (!marked.count) continue;
      try {
        await this.storage.deleteObject(candidate.objectKey);
        const result = await this.database.recording.deleteMany({
          where: {
            id: candidate.id,
            userId: null,
            deletionRequestedAt: { not: null },
          },
        });
        deleted += result.count;
      } catch {
        // Keep the row and object key so the next sweep can retry safely.
        failed += 1;
      }
    }
    // Never cascade-delete a session that still has media awaiting cleanup.
    const sessions = await this.database.guestSession.deleteMany({
      where: { expiresAt: { lte: now }, recordings: { none: {} } },
    });
    return { deleted, failed, sessions: sessions.count };
  }
}
