import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  logEvent,
  withLogContext,
  publicTranscriptionError,
} from '@sonavra/config';
import {
  createQueuedTranscriptionJob,
  type PrismaClient,
} from '@sonavra/database';
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
  readonly metrics = {
    active: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    discarded: 0,
    totalDurationMs: 0,
  };
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
        where: { id: recordingId, deletionRequestedAt: null },
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

      const job = await createQueuedTranscriptionJob(tx, recordingId);
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
    const recording = await this.database.recording.findUnique({
      where: { id: job.recordingId },
      select: { requestId: true },
    });
    await withLogContext(
      {
        requestId: recording?.requestId ?? job.id,
        recordingId: job.recordingId,
        jobId: job.id,
      },
      () => this.process(job.id, job.recordingId, job.attemptCount),
    );
    return true;
  }

  private async claimNext() {
    const rows = await this.database.$queryRaw<
      Array<{ id: string; recordingId: string; attemptCount: number }>
    >`
      WITH candidate AS (
        SELECT "id"
        FROM "TranscriptionJob"
        WHERE (
          ("status" = 'QUEUED' AND "availableAt" <= NOW())
          OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < NOW())
        )
        AND "attemptCount" < ${this.maxAttempts}
        AND EXISTS (SELECT 1 FROM "Recording" WHERE "Recording"."id" = "TranscriptionJob"."recordingId" AND "deletionRequestedAt" IS NULL)
        ORDER BY "availableAt", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "TranscriptionJob" job
      SET "status" = 'PROCESSING',
          "attemptCount" = job."attemptCount" + 1,
          "startedAt" = NOW(),
          "leaseExpiresAt" = NOW() + (${this.leaseMs} * INTERVAL '1 millisecond'),
          "errorCode" = NULL,
          "errorMessage" = NULL,
          "retryable" = false,
          "updatedAt" = NOW()
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id", job."recordingId", job."attemptCount"
    `;

    const job = rows[0];
    if (job) {
      const updated = await this.database.recording.updateMany({
        where: { id: job.recordingId, deletionRequestedAt: null },
        data: { status: 'PROCESSING' },
      });
      if (!updated.count) return undefined;
    }
    return job;
  }

  private async process(
    jobId: string,
    recordingId: string,
    attemptCount: number,
  ) {
    const recording = await this.database.recording.findFirst({
      where: { id: recordingId, deletionRequestedAt: null },
    });
    if (!recording) return;
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sonavra-job-'));
    this.metrics.active++;
    const started = performance.now();
    logEvent('worker', 'job_started', { attemptCount });
    let renewing: Promise<unknown> | undefined;
    const heartbeat = setInterval(
      () => {
        if (renewing) return;
        renewing = this.database
          .$executeRaw`UPDATE "TranscriptionJob" SET "leaseExpiresAt" = NOW() + (${this.leaseMs} * INTERVAL '1 millisecond') WHERE "id" = ${jobId}::uuid AND "status" = 'PROCESSING' AND "attemptCount" = ${attemptCount}`
          .catch(() => {
            logEvent('worker', 'lease_renewal_failed');
          })
          .finally(() => {
            renewing = undefined;
          });
      },
      Math.max(10, Math.floor(this.leaseMs / 3)),
    );
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

      logEvent('worker', 'preprocessing_started');
      const normalized = await this.preprocessor.normalize(sourcePath);
      logEvent('worker', 'preprocessing_completed', {
        durationMs: Math.round(performance.now() - started),
      });
      try {
        const result = await this.engine.transcribe({
          source: { kind: 'file', path: normalized.path },
          detectLanguage: true,
          diarization: true,
          correlation: {
            requestId: recording.requestId ?? jobId,
            recordingId,
            jobId,
          },
        });
        if (result.telemetry)
          logEvent('runtime', 'transcription_completed', result.telemetry);
        const saved = await this.persistResult(
          jobId,
          recordingId,
          result,
          attemptCount,
        );
        if (saved) {
          this.metrics.completed++;
          logEvent('worker', 'job_completed');
        } else {
          this.metrics.discarded++;
          logEvent('worker', 'job_discarded');
        }
      } finally {
        await normalized.dispose();
      }
    } catch (error) {
      await this.fail(jobId, recordingId, error, attemptCount);
    } finally {
      clearInterval(heartbeat);
      await renewing;
      this.metrics.active--;
      const durationMs = Math.round(performance.now() - started);
      this.metrics.totalDurationMs += durationMs;
      logEvent('worker', 'job_finished', { durationMs });
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async persistResult(
    jobId: string,
    recordingId: string,
    result: TranscriptionResult,
    attemptCount: number,
  ) {
    return this.database.$transaction(async (tx) => {
      const parents = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Recording" WHERE "id" = ${recordingId}::uuid AND "deletionRequestedAt" IS NULL FOR UPDATE`;
      if (!parents.length) return false;
      const leased = await tx.transcriptionJob.updateMany({
        where: { id: jobId, status: 'PROCESSING', attemptCount },
        data: { provider: result.engine },
      });
      if (!leased.count) return false;
      const active = await tx.recording.updateMany({
        where: { id: recordingId, deletionRequestedAt: null },
        data: { status: 'COMPLETED', durationMs: result.durationMs },
      });
      if (!active.count) return false;
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
      return true;
    });
  }

  private async fail(
    jobId: string,
    recordingId: string,
    error: unknown,
    attemptCount: number,
  ) {
    const job = await this.database.transcriptionJob.findUnique({
      where: { id: jobId },
      select: { attemptCount: true },
    });
    if (!job || job.attemptCount !== attemptCount) return;
    const engineError = isTranscriptionEngineError(error) ? error : undefined;
    const retryable = engineError?.retryable ?? true;
    const canRetry = retryable && job.attemptCount < this.maxAttempts;
    const errorCode = engineError?.code ?? 'worker_error';
    const errorMessage = publicTranscriptionError(errorCode);

    await this.database.$transaction(async (tx) => {
      const parents = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Recording" WHERE "id" = ${recordingId}::uuid AND "deletionRequestedAt" IS NULL FOR UPDATE`;
      if (!parents.length) return;
      const leased = await tx.transcriptionJob.updateMany({
        where: { id: jobId, status: 'PROCESSING', attemptCount },
        data: { errorCode, errorMessage },
      });
      if (!leased.count) return;
      const [clock] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT NOW() AS now`;
      const active = await tx.recording.updateMany({
        where: { id: recordingId, deletionRequestedAt: null },
        data: { status: canRetry ? 'QUEUED' : 'FAILED' },
      });
      if (!active.count) return;
      await tx.transcriptionJob.update({
        where: { id: jobId },
        data: canRetry
          ? {
              status: 'QUEUED',
              retryable: true,
              errorCode,
              errorMessage,
              availableAt: new Date(
                clock!.now.getTime() + this.retryDelayMs * job.attemptCount,
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
      });
      if (canRetry) this.metrics.retried++;
      else this.metrics.failed++;
      logEvent('worker', canRetry ? 'job_retried' : 'job_failed', {
        errorCode,
        attemptCount,
      });
    });
  }
}
