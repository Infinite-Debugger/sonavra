import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { apiPort } from '@sonavra/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(apiPort);
}
void bootstrap();
