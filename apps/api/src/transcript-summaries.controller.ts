import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AuthError, AuthService, validateAuthRequest } from './auth.js';
import { guestSessionFrom } from './guest-claims.js';
import { recordingAccess } from './recording-access.js';
import { SummaryError } from './summary-generator.js';
import { TranscriptSummaryService } from './transcript-summaries.js';

@Controller('recordings/:recordingId/summary')
export class TranscriptSummariesController {
  private readonly summaries = new TranscriptSummaryService();
  private readonly auth = new AuthService(this.summaries.database);

  async onModuleDestroy() {
    await this.auth.close();
  }

  private async run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SummaryError || error instanceof AuthError)
        throw new HttpException(error.message, error.status);
      // Persistence errors can include generated text in query diagnostics.
      throw new HttpException(
        'The summary request failed. Please try again. Your transcript remains available.',
        503,
      );
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  get(
    @Param('recordingId') id: string,
    @Query('guestSessionId') guest: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ) {
    return this.run(async () =>
      this.summaries.get(
        id,
        async () => (await recordingAccess(this.auth, cookie, guest)).where,
      ),
    );
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  generate(
    @Param('recordingId') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    return this.run(async () => {
      validateAuthRequest(origin, contentType);
      // Malformed guest credentials are treated as absent; they never grant access.
      let guest: string | undefined;
      try {
        guest = guestSessionFrom(body);
      } catch {
        guest = undefined;
      }
      return this.summaries.generate(
        id,
        async () => (await recordingAccess(this.auth, cookie, guest)).where,
      );
    });
  }
}
