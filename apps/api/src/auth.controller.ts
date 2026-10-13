import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthError,
  AuthService,
  authOrigin,
  sessionCookie,
  sessionToken,
  validateAuthRequest,
} from './auth.js';
import { GuestClaimValidationError } from './guest-claims.js';

type ResponseHeaders = { setHeader(name: string, value: string): void };

@Controller('auth')
export class AuthController {
  private readonly auth = new AuthService();

  constructor() {
    authOrigin();
  }

  async onModuleDestroy() {
    await this.auth.close();
  }
  @Post('signup')
  async signUp(
    @Body() body: unknown,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    return this.authenticate(
      'signUp',
      body,
      origin,
      contentType,
      cookie,
      response,
    );
  }

  @Post('signin')
  @HttpCode(200)
  async signIn(
    @Body() body: unknown,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    return this.authenticate(
      'signIn',
      body,
      origin,
      contentType,
      cookie,
      response,
    );
  }

  private async authenticate(
    method: 'signIn' | 'signUp',
    body: unknown,
    origin: string | undefined,
    contentType: string | undefined,
    cookie: string | undefined,
    response: ResponseHeaders,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      validateAuthRequest(origin, contentType);
      const { user, token, ...claim } = await this.auth[method](
        body,
        sessionToken(cookie),
      );
      response.setHeader('Set-Cookie', sessionCookie(token));
      return { user, ...claim };
    } catch (error) {
      if (error instanceof AuthError)
        throw new HttpException(error.message, error.status);
      if (error instanceof GuestClaimValidationError)
        throw new HttpException(error.message, 400);
      throw error;
    }
  }

  @Get('session')
  async session(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { user: await this.auth.currentUser(sessionToken(cookie)) };
  }

  @Get('account')
  async account(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const user = await this.auth.currentUser(sessionToken(cookie));
    if (!user) throw new UnauthorizedException();
    return { user };
  }

  @Post('signout')
  @HttpCode(200)
  async signOut(
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      validateAuthRequest(origin, contentType);
      await this.auth.signOut(sessionToken(cookie));
      response.setHeader('Set-Cookie', sessionCookie());
      return { user: null };
    } catch (error) {
      if (error instanceof AuthError)
        throw new HttpException(error.message, error.status);
      throw error;
    }
  }

  @Post('claim')
  @HttpCode(200)
  async claim(
    @Body() body: unknown,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      validateAuthRequest(origin, contentType);
      return await this.auth.claimGuestWork(sessionToken(cookie), body);
    } catch (error) {
      if (error instanceof AuthError)
        throw new HttpException(error.message, error.status);
      if (error instanceof GuestClaimValidationError)
        throw new HttpException(error.message, 400);
      throw error;
    }
  }
}
