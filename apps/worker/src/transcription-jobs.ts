import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { PrismaClient } from '@sonavra/database';
import type { ObjectStorage } from '@sonavra/storage';
import {
  TranscriptionEngineError,
  type NormalizedMedia,
  type TranscriptionEngine,
  type TranscriptionResult,
} from '@sonavra/transcription';

function isTranscriptionEngineError(
  error: unknown,
): error is TranscriptionEngineError {
  return (
    error instanceof Error &&
    error.name === 'TranscriptionEngineError' &&
    'retryable' in error &&
    typeof error.retryable === 'boolean' &&
    'code' in error &&
    typeof error.code === 'string'
  );
}

export interface MediaNormalizer {
  normalize(sourcePath: string): Promise<NormalizedMedia>;
}

export interface TranscriptionJobProcessorOptions {
  maxAttempts?: number;
  leaseMs?: number;
  retryDelayMs?: number;
}

export class TranscriptionJobProcessor {
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly database: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly preprocessor: MediaNormalizer,
    private readonly engine: TranscriptionEngine,
    options: TranscriptionJobProcessorOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.leaseMs = options.leaseMs ?? 10 * 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
  }

  async enqueue(recordingId: string) {
    return this.database.$transaction(async (tx) => {
      const recording = await tx.recording.findUnique({
        where: { id: recordingId },
        select: { id: true, status: true },
      });
      if (!recording) throw new Error('Recording not found');

      const active = await tx.transcriptionJob.findFirst({
        where: {
          recordingId,
          status: { in: ['QUEUED', 'PROCESSING'] },
        },
      });
      if (active) return active;

      const job = await tx.transcriptionJob.create({
        data: { recordingId, status: 'QUEUED', availableAt: new Date() },
      });
      await tx.recording.update({
        where: { id: recordingId },
        data: { status: 'QUEUED' },
      });
      return job;
    });
  }

  async processNext(): Promise<boolean> {
    const job = await this.claimNext();
    if (!job) return false;
    await this.process(job.id, job.recordingId);
    return true;
  }

  private async claimNext() {
    const leaseExpiresAt = new Date(Date.now() + this.leaseMs);
    const rows = await this.database.$queryRaw<
      Array<{ id: string; recordingId: string }>
    >`
      WITH candidate AS (
        SELECT "id"
        FROM "TranscriptionJob"
        WHERE (
          ("status" = 'QUEUED' AND "availableAt" <= NOW())
          OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < NOW())
        )
        AND "attemptCount" < ${this.maxAttempts}
        ORDER BY "availableAt", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "TranscriptionJob" job
      SET "status" = 'PROCESSING',
          "attemptCount" = job."attemptCount" + 1,
          "startedAt" = NOW(),
          "leaseExpiresAt" = ${leaseExpiresAt},
          "errorCode" = NULL,
          "errorMessage" = NULL,
          "retryable" = false,
          "updatedAt" = NOW()
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id", job."recordingId"
    `;

    const job = rows[0];
    if (job) {
      await this.database.recording.update({
        where: { id: job.recordingId },
        data: { status: 'PROCESSING' },
      });
    }
    return job;
  }

  private async process(jobId: string, recordingId: string) {
    const recording = await this.database.recording.findUniqueOrThrow({
      where: { id: recordingId },
    });
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sonavra-job-'));
    const sourcePath = join(workingDirectory, 'source-media');

    try {
      const response = await this.storage.downloadObject(recording.objectKey);
      if (!response.body) {
        throw new Error('Object storage returned an empty body');
      }
      await pipeline(
        Readable.fromWeb(
          response.body as import('node:stream/web').ReadableStream,
        ),
        createWriteStream(sourcePath, { mode: 0o600 }),
      );

      const normalized = await this.preprocessor.normalize(sourcePath);
      try {
        const result = await this.engine.transcribe({
          source: { kind: 'file', path: normalized.path },
          detectLanguage: true,
          diarization: true,
        });
        await this.persistResult(jobId, recordingId, result);
      } finally {
        await normalized.dispose();
      }
    } catch (error) {
      await this.fail(jobId, recordingId, error);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async persistResult(
    jobId: string,
    recordingId: string,
    result: TranscriptionResult,
  ) {
    await this.database.$transaction(async (tx) => {
      const existing = await tx.transcript.findUnique({
        where: { recordingId },
        select: { id: true },
      });
      if (existing) {
        await tx.transcript.delete({ where: { id: existing.id } });
      }

      const transcript = await tx.transcript.create({
        data: { recordingId, language: result.language },
      });
      const speakerIds = new Map<string, string>();
      for (const speaker of result.speakers) {
        const persisted = await tx.speaker.create({
          data: {
            transcriptId: transcript.id,
            label: speaker.label,
          },
        });
        speakerIds.set(speaker.id, persisted.id);
      }
      for (const [sequence, segment] of result.segments.entries()) {
        await tx.transcriptSegment.create({
          data: {
            transcriptId: transcript.id,
            speakerId: segment.speakerId
              ? speakerIds.get(segment.speakerId)
              : undefined,
            sequence,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
          },
        });
      }

      await tx.recording.update({
        where: { id: recordingId },
        data: {
          status: 'COMPLETED',
          durationMs: result.durationMs,
        },
      });
      await tx.transcriptionJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          provider: result.engine,
          retryable: false,
          leaseExpiresAt: null,
          completedAt: new Date(),
        },
      });
    });
  }

  private async fail(jobId: string, recordingId: string, error: unknown) {
    const job = await this.database.transcriptionJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { attemptCount: true },
    });
    const engineError = isTranscriptionEngineError(error) ? error : undefined;
    const retryable = engineError?.retryable ?? true;
    const canRetry = retryable && job.attemptCount < this.maxAttempts;
    const errorCode = engineError?.code ?? 'worker_error';
    const errorMessage =
      error instanceof Error
        ? error.message.slice(0, 500)
        : 'Unknown worker failure';

    await this.database.$transaction([
      this.database.transcriptionJob.update({
        where: { id: jobId },
        data: canRetry
          ? {
              status: 'QUEUED',
              retryable: true,
              errorCode,
              errorMessage,
              availableAt: new Date(
                Date.now() + this.retryDelayMs * job.attemptCount,
              ),
              leaseExpiresAt: null,
            }
          : {
              status: 'FAILED',
              retryable,
              errorCode,
              errorMessage,
              leaseExpiresAt: null,
              completedAt: new Date(),
            },
      }),
      this.database.recording.update({
        where: { id: recordingId },
        data: { status: canRetry ? 'QUEUED' : 'FAILED' },
      }),
    ]);
  }
}
