import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { apiPort } from '@sonavra/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', methods: ['GET', 'POST', 'OPTIONS'] });
  await app.listen(apiPort);
}
void bootstrap();
