import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createDatabase } from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';
import { guestRetentionHours } from '@sonavra/config';
import { UploadService } from './uploads.js';

it(
  'assigns guest deadlines, preserves existing deadlines, and replaces expired sessions',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const database = createDatabase();
    const service = new UploadService(database, createS3ObjectStorageFromEnv());
    const guests: string[] = [];
    const input = {
      filename: 'synthetic.ogg',
      mimeType: 'audio/ogg',
      sizeBytes: 5,
    };
    const before = Date.now();
    try {
      const first = await service.createUpload(input);
      guests.push(first.guestSessionId);
      const expiry = Date.parse(first.expiresAt);
      assert.ok(expiry >= before + guestRetentionHours() * 3600000);
      assert.ok(expiry <= Date.now() + guestRetentionHours() * 3600000);
      const row = await database.recording.findUniqueOrThrow({
        where: { id: first.recordingId },
      });
      assert.equal(row.expiresAt?.toISOString(), first.expiresAt);
      const second = await service.createUpload({
        ...input,
        guestSessionId: first.guestSessionId,
      });
      assert.equal(second.expiresAt, first.expiresAt);
      await database.guestSession.update({
        where: { id: first.guestSessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const replacement = await service.createUpload({
        ...input,
        guestSessionId: first.guestSessionId,
      });
      guests.push(replacement.guestSessionId);
      assert.notEqual(replacement.guestSessionId, first.guestSessionId);
      // Existing sessions close to expiry cannot issue upload URLs beyond the deadline.
      const deadline = new Date(Date.now() + 120000);
      await database.guestSession.update({
        where: { id: replacement.guestSessionId },
        data: { expiresAt: deadline },
      });
      const last = await service.createUpload({
        ...input,
        guestSessionId: replacement.guestSessionId,
      });
      assert.ok(Date.parse(last.upload.expiresAt) <= deadline.getTime());
    } finally {
      await database.guestSession.deleteMany({ where: { id: { in: guests } } });
      await database.$disconnect();
    }
  },
);
