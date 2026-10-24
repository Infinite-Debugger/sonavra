import { healthAuthorized } from '@sonavra/config';
import {
  Controller,
  Get,
  Headers,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { createDatabase } from '@sonavra/database';
import { createS3ObjectStorageFromEnv } from '@sonavra/storage';

@Controller()
export class HealthController {
  private readonly database = createDatabase();
  private readonly storage = createS3ObjectStorageFromEnv();
  async onModuleDestroy() {
    await this.database.$disconnect();
  }

  @Get('ready')
  async ready(@Headers('authorization') authorization?: string) {
    if (!healthAuthorized(authorization)) throw new NotFoundException();
    const checks = await Promise.allSettled([
      this.database.$queryRaw`SELECT 1`,
      this.storage.checkReadiness(),
    ]);
    const ready = checks.every((check) => check.status === 'fulfilled');
    const body = {
      status: ready ? 'ready' : 'unavailable',
      database: checks[0]!.status === 'fulfilled',
      storage: checks[1]!.status === 'fulfilled',
    };
    if (!ready) throw new HttpException(body, 503);
    return body;
  }
}
