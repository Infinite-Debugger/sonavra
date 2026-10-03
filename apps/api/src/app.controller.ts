import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { createDatabase } from '@sonavra/database';

const database = createDatabase();

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('recordings/:recordingId/transcription-jobs')
  @HttpCode(202)
  async enqueueTranscription(@Param('recordingId') recordingId: string) {
    const recording = await database.recording.findUnique({
      where: { id: recordingId },
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
