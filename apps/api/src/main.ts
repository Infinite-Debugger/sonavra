import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiPort,
  ConfigurationError,
  logEvent,
  validateProductionConfiguration,
} from '@sonavra/config';
import { configureOperations, OperationalDatabase } from './operations.js';

async function bootstrap() {
  validateProductionConfiguration('api');
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  configureOperations(app, app.get(OperationalDatabase).client);
  app.useBodyParser('json', { limit: '128kb' });
  app.enableShutdownHooks();
  await app.listen(apiPort, process.env.API_HOST ?? '127.0.0.1');
  logEvent('api', 'started');
}
void bootstrap().catch((error: unknown) => {
  logEvent('api', 'startup_failed', {
    errorCode:
      error instanceof ConfigurationError
        ? error.fields.join(',')
        : 'startup_failed',
  });
  process.exitCode = 1;
});
