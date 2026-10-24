import { TranscriptSummariesController } from './transcript-summaries.controller.js';
import { HealthController } from './health.controller.js';
import { OperationalDatabase } from './operations.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthController } from './auth.controller.js';
import { LibraryController } from './library.controller.js';

@Module({
  providers: [OperationalDatabase],
  controllers: [
    AppController,
    HealthController,
    AuthController,
    LibraryController,
    TranscriptSummariesController,
  ],
})
export class AppModule {}
