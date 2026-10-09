import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CompleteUploadRequest,
  CreateUploadRequest,
  RecordingStatusResponse,
  TranscriptResponse,
  UpdateTranscriptSegmentRequest,
  UpdateTranscriptSpeakerRequest,
} from '@sonavra/types';
import { createDatabase } from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';
import { UploadService, UploadValidationError } from './uploads.js';
import {
  normalizeSegmentText,
  normalizeSpeakerName,
  TranscriptEditValidationError,
} from './transcript-edits.js';

const uploads = new UploadService();
const database = createDatabase();
const storage = createS3ObjectStorageFromEnv();

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
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
  ): Promise<RecordingStatusResponse> {
    if (!guestSessionId) throw new NotFoundException('Recording not found');
    const recording = await database.recording.findFirst({
      where: { id: recordingId, guestSessionId },
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
      errorMessage: job?.status === 'FAILED' ? job.errorMessage : null,
    };
  }

  @Get('recordings/:recordingId/transcript')
  async transcript(
    @Param('recordingId') recordingId: string,
    @Query('guestSessionId') guestSessionId: string,
  ): Promise<TranscriptResponse> {
    if (!guestSessionId) throw new NotFoundException('Transcript not found');
    const recording = await database.recording.findFirst({
      where: { id: recordingId, guestSessionId },
      include: {
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
    const media = await storage.presignDownload(recording.objectKey, 60 * 60);
    return {
      recordingId,
      filename: recording.originalFilename,
      language: recording.transcript.language,
      durationMs: recording.durationMs,
      media: {
        url: media.url,
        mimeType: recording.mimeType,
        expiresAt: media.expiresAt.toISOString(),
      },
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
  ) {
    if (!body.guestSessionId) {
      throw new NotFoundException('Transcript segment not found');
    }

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
          recording: { id: recordingId, guestSessionId: body.guestSessionId },
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
  ) {
    if (!body.guestSessionId) {
      throw new NotFoundException('Transcript speaker not found');
    }

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
          recording: { id: recordingId, guestSessionId: body.guestSessionId },
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
  ) {
    if (!body.guestSessionId) {
      throw new NotFoundException('Recording not found');
    }
    const recording = await database.recording.findFirst({
      where: { id: recordingId, guestSessionId: body.guestSessionId },
      select: { id: true },
    });
    if (!recording) throw new NotFoundException('Recording not found');

    const job = await database.$transaction(async (tx) => {
      const active = await tx.transcriptionJob.findFirst({
        where: { recordingId, status: { in: ['QUEUED', 'PROCESSING'] } },
      });
      if (active) return active;

      const created = await tx.transcriptionJob.create({
        data: { recordingId, status: 'QUEUED', availableAt: new Date() },
      });
      await tx.recording.update({
        where: { id: recordingId },
        data: { status: 'QUEUED' },
      });
      return created;
    });

    return { jobId: job.id, status: job.status };
  }

  @Get('transcription-jobs/:jobId')
  async transcriptionJob(@Param('jobId') jobId: string) {
    const job = await database.transcriptionJob.findUnique({
      where: { id: jobId },
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
    return job;
  }
}
