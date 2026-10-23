import { TranscriptSummariesController } from './transcript-summaries.controller.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthController } from './auth.controller.js';
import { LibraryController } from './library.controller.js';

@Module({
  controllers: [
    AppController,
    AuthController,
    LibraryController,
    TranscriptSummariesController,
  ],
})
export class AppModule {}
