import { createDatabase, type PrismaClient } from '@sonavra/database';
import {
  createS3ObjectStorageFromEnv,
  type ObjectStorage,
} from '@sonavra/storage';
import type {
  CompleteUploadResponse,
  CreateUploadRequest,
  CreateUploadResponse,
} from '@sonavra/types';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const GUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_MIME_TYPES = new Set([
  'application/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
  'video/mp4',
  'video/webm',
]);

export class UploadValidationError extends Error {}

export function validateUploadInput(input: CreateUploadRequest) {
  const filename = input.filename?.trim();
  const mimeType = input.mimeType?.trim().toLowerCase();
  const sizeBytes = input.sizeBytes;

  if (!filename || filename.length > 255) {
    throw new UploadValidationError('Choose a file with a valid filename.');
  }
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new UploadValidationError(
      'Unsupported media type. Use OGG, MP3, WAV, MP4, M4A, or WebM.',
    );
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new UploadValidationError('The selected file is empty or invalid.');
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError('The selected file exceeds the 500 MB limit.');
  }

  return { filename, mimeType, sizeBytes };
}

export class UploadService {
  constructor(
    private readonly database: PrismaClient = createDatabase(),
    private readonly storage: ObjectStorage = createS3ObjectStorageFromEnv(),
  ) {}

  async createUpload(input: CreateUploadRequest): Promise<CreateUploadResponse> {
    const media = validateUploadInput(input);
    const expiresAt = new Date(Date.now() + GUEST_RETENTION_MS);
    const guest = input.guestSessionId
      ? await this.database.guestSession.findUnique({
          where: { id: input.guestSessionId },
        })
      : await this.database.guestSession.create({ data: { expiresAt } });

    if (!guest || guest.expiresAt <= new Date()) {
      throw new UploadValidationError('Guest session is invalid or expired.');
    }

    const upload = await this.storage.presignUpload(media.mimeType);
    const recording = await this.database.recording.create({
      data: {
        guestSessionId: guest.id,
        originalFilename: media.filename,
        objectKey: upload.key,
        mimeType: media.mimeType,
        sizeBytes: BigInt(media.sizeBytes),
        status: 'UPLOADING',
        expiresAt: guest.expiresAt,
      },
    });

    return {
      recordingId: recording.id,
      guestSessionId: guest.id,
      expiresAt: guest.expiresAt.toISOString(),
      upload: {
        url: upload.url,
        method: upload.method,
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      },
    };
  }

  async completeUpload(
    recordingId: string,
    guestSessionId: string,
  ): Promise<CompleteUploadResponse> {
    const recording = await this.database.recording.findFirst({
      where: { id: recordingId, guestSessionId },
    });

    if (
      !recording ||
      recording.expiresAt === null ||
      recording.expiresAt <= new Date()
    ) {
      throw new UploadValidationError('Upload is invalid or expired.');
    }
    if (recording.status === 'UPLOADED') {
      return {
        recordingId: recording.id,
        status: 'UPLOADED',
        expiresAt: recording.expiresAt.toISOString(),
      };
    }
    if (recording.status !== 'UPLOADING') {
      throw new UploadValidationError(
        'Upload cannot be completed in its current state.',
      );
    }

    const object = await this.storage.statObject(recording.objectKey);
    if (!object) {
      throw new UploadValidationError('The media upload has not completed.');
    }
    if (object.contentLength !== Number(recording.sizeBytes)) {
      throw new UploadValidationError(
        'Uploaded file size does not match the selected file.',
      );
    }
    if (
      object.contentType &&
      object.contentType.split(';', 1)[0]?.trim().toLowerCase() !==
        recording.mimeType
    ) {
      throw new UploadValidationError(
        'Uploaded media type does not match the selected file.',
      );
    }

    await this.database.recording.update({
      where: { id: recording.id },
      data: { status: 'UPLOADED' },
    });

    return {
      recordingId: recording.id,
      status: 'UPLOADED',
      expiresAt: recording.expiresAt.toISOString(),
    };
  }
}
