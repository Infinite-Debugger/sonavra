import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthController } from './auth.controller.js';

@Module({ controllers: [AppController, AuthController] })
export class AppModule {}
