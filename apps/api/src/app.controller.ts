import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type {
  CompleteUploadRequest,
  CreateUploadRequest,
} from '@sonavra/types';
import { UploadService, UploadValidationError } from './uploads.js';

const uploads = new UploadService();

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
}
