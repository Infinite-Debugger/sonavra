import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CompleteUploadRequest,
  CreateUploadRequest,
  RecordingMediaResponse,
  RecordingStatusResponse,
  TranscriptResponse,
  UpdateTranscriptSegmentRequest,
  UpdateTranscriptSpeakerRequest,
} from '@sonavra/types';
import {
  guestRetentionHours,
  logEvent,
  publicTranscriptionError,
} from '@sonavra/config';
import {
  createDatabase,
  createQueuedTranscriptionJob,
} from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';
import { UploadService, UploadValidationError } from './uploads.js';
import {
  normalizeSegmentText,
  normalizeSpeakerName,
  TranscriptEditValidationError,
} from './transcript-edits.js';
import { AuthService, AuthError, validateAuthRequest } from './auth.js';
import { recordingAccess } from './recording-access.js';

const uploads = new UploadService();
const database = createDatabase();
const auth = new AuthService(database);
const storage = createS3ObjectStorageFromEnv();

@Controller()
export class AppController {
  private async signMedia(recording: {
    objectKey: string;
    mimeType: string;
    expiresAt: Date | null;
    guestSession: { expiresAt: Date } | null;
  }): Promise<RecordingMediaResponse> {
    const deadlines = [
      recording.expiresAt,
      recording.guestSession?.expiresAt,
    ].filter((date): date is Date => Boolean(date));
    const ttl = Math.min(
      3600,
      ...deadlines.map((date) =>
        Math.floor((date.getTime() - Date.now()) / 1000),
      ),
    );
    if (ttl < 1) throw new NotFoundException('Recording not found');
    const media = await storage.presignDownload(recording.objectKey, ttl);
    return {
      url: media.url,
      mimeType: recording.mimeType,
      expiresAt: media.expiresAt.toISOString(),
    };
  }

  async onModuleDestroy() {
    await auth.close();
  }
  private async mutationAccess(
    cookie: string | undefined,
    guestSessionId: string | undefined,
    origin: string | undefined,
    contentType: string | undefined,
  ) {
    const access = await recordingAccess(auth, cookie, guestSessionId);
    if (access.userId) {
      try {
        validateAuthRequest(origin, contentType);
      } catch (error) {
        if (error instanceof AuthError)
          throw new HttpException(error.message, error.status);
        throw error;
      }
    }
    return access;
  }
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('uploads/policy')
  uploadPolicy() {
    return { guestRetentionHours: guestRetentionHours() };
  }

  @Post('uploads')
  async createUpload(@Body() body: CreateUploadRequest) {
    try {
      return await uploads.createUpload(body);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post('uploads/:recordingId/complete')
  @HttpCode(200)
  async completeUpload(
    @Param('recordingId') recordingId: string,
    @Body() body: CompleteUploadRequest,
  ) {
    try {
      return await uploads.completeUpload(recordingId, body.guestSessionId);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
  @Get('recordings/:recordingId/status')
  async recordingStatus(
    @Param('recordingId') recordingId: string,
    @Query('guestSessionId') guestSessionId: string,
    @Headers('cookie') cookie: string | undefined,
  ): Promise<RecordingStatusResponse> {
    const access = await recordingAccess(auth, cookie, guestSessionId);
    const recording = await database.recording.findFirst({
      where: { id: recordingId, ...access.where },
      include: {
        transcriptionJobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!recording) throw new NotFoundException('Recording not found');
    const job = recording.transcriptionJobs[0];
    return {
      recordingId,
      status: recording.status as RecordingStatusResponse['status'],
      jobId: job?.id ?? null,
      retryable: job?.retryable ?? false,
      errorMessage:
        job?.status === 'FAILED'
          ? publicTranscriptionError(job.errorCode)
          : null,
      ownership: recording.userId ? 'account' : 'guest',
      canClaim: !recording.userId && Boolean(access.userId),
      expiresAt: recording.expiresAt?.toISOString() ?? null,
    };
  }

  @Get('recordings/:recordingId/media')
  @Header('Cache-Control', 'no-store')
  async recordingMedia(
    @Param('recordingId') recordingId: string,
    @Query('guestSessionId') guestSessionId: string,
    @Headers('cookie') cookie: string | undefined,
  ): Promise<RecordingMediaResponse> {
    const access = await recordingAccess(auth, cookie, guestSessionId);
    const recording = await database.recording.findFirst({
      where: { id: recordingId, ...access.where },
      include: { guestSession: true },
    });
    if (!recording) throw new NotFoundException('Recording not found');
    return this.signMedia(recording);
  }

  @Get('recordings/:recordingId/transcript')
  @Header('Cache-Control', 'no-store')
  async transcript(
    @Param('recordingId') recordingId: string,
    @Query('guestSessionId') guestSessionId: string,
    @Headers('cookie') cookie: string | undefined,
  ): Promise<TranscriptResponse> {
    const access = await recordingAccess(auth, cookie, guestSessionId);
    const recording = await database.recording.findFirst({
      where: { id: recordingId, ...access.where },
      include: {
        guestSession: true,
        transcript: {
          include: {
            speakers: true,
            segments: { orderBy: { sequence: 'asc' } },
          },
        },
      },
    });
    if (!recording || !recording.transcript) {
      throw new NotFoundException('Transcript not found');
    }
    const media = await this.signMedia(recording);
    return {
      recordingId,
      filename: recording.originalFilename,
      title: recording.title,
      language: recording.transcript.language,
      durationMs: recording.durationMs,
      media,
      speakers: recording.transcript.speakers.map((speaker) => ({
        id: speaker.id,
        label: speaker.label,
        displayName: speaker.displayName,
      })),
      segments: recording.transcript.segments.map((segment) => ({
        id: segment.id,
        sequence: segment.sequence,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        speakerId: segment.speakerId,
      })),
    };
  }

  @Patch('recordings/:recordingId/transcript/segments/:segmentId')
  async updateTranscriptSegment(
    @Param('recordingId') recordingId: string,
    @Param('segmentId') segmentId: string,
    @Body() body: UpdateTranscriptSegmentRequest,
    @Headers('cookie') cookie: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    const access = await this.mutationAccess(
      cookie,
      body.guestSessionId,
      origin,
      contentType,
    );

    let text: string;
    try {
      text = normalizeSegmentText(body.text);
    } catch (error) {
      if (error instanceof TranscriptEditValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const result = await database.transcriptSegment.updateMany({
      where: {
        id: segmentId,
        transcript: {
          recording: { id: recordingId, ...access.where },
        },
      },
      data: { text },
    });
    if (result.count !== 1) {
      throw new NotFoundException('Transcript segment not found');
    }
    return { id: segmentId, text };
  }

  @Patch('recordings/:recordingId/transcript/speakers/:speakerId')
  async updateTranscriptSpeaker(
    @Param('recordingId') recordingId: string,
    @Param('speakerId') speakerId: string,
    @Body() body: UpdateTranscriptSpeakerRequest,
    @Headers('cookie') cookie: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    const access = await this.mutationAccess(
      cookie,
      body.guestSessionId,
      origin,
      contentType,
    );

    let displayName: string;
    try {
      displayName = normalizeSpeakerName(body.displayName);
    } catch (error) {
      if (error instanceof TranscriptEditValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const result = await database.speaker.updateMany({
      where: {
        id: speakerId,
        transcript: {
          recording: { id: recordingId, ...access.where },
        },
      },
      data: { displayName },
    });
    if (result.count !== 1) {
      throw new NotFoundException('Transcript speaker not found');
    }
    return { id: speakerId, displayName };
  }

  @Post('recordings/:recordingId/transcription-jobs')
  @HttpCode(202)
  async enqueueTranscription(
    @Param('recordingId') recordingId: string,
    @Body() body: { guestSessionId?: string },
    @Headers('cookie') cookie: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    const access = await this.mutationAccess(
      cookie,
      body.guestSessionId,
      origin,
      contentType,
    );
    const recording = await database.recording.findFirst({
      where: { id: recordingId, ...access.where },
      select: { id: true },
    });
    if (!recording) throw new NotFoundException('Recording not found');

    const job = await database.$transaction(async (tx) => {
      const active = await tx.transcriptionJob.findFirst({
        where: { recordingId, status: { in: ['QUEUED', 'PROCESSING'] } },
      });
      if (active) return active;

      const created = await createQueuedTranscriptionJob(tx, recordingId);
      await tx.recording.update({
        where: { id: recordingId },
        data: { status: 'QUEUED' },
      });
      return created;
    });

    logEvent('api', 'job_queued', { recordingId, jobId: job.id });
    return { jobId: job.id, status: job.status };
  }

  @Get('transcription-jobs/:jobId')
  async transcriptionJob(
    @Param('jobId') jobId: string,
    @Query('guestSessionId') guestSessionId: string,
    @Headers('cookie') cookie: string | undefined,
  ) {
    const access = await recordingAccess(auth, cookie, guestSessionId);
    const job = await database.transcriptionJob.findFirst({
      where: { id: jobId, recording: access.where },
      select: {
        id: true,
        recordingId: true,
        status: true,
        attemptCount: true,
        retryable: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
    if (!job) throw new NotFoundException('Transcription job not found');
    return {
      ...job,
      errorMessage: job.errorMessage
        ? publicTranscriptionError(job.errorCode)
        : null,
    };
  }
}
