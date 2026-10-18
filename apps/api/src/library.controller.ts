import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  AuthError,
  AuthService,
  sessionToken,
  validateAuthRequest,
} from './auth.js';
import { LibraryError, LibraryService, libraryQuery } from './library.js';

@Controller('library/recordings')
export class LibraryController {
  private readonly library = new LibraryService();
  private readonly auth = new AuthService(this.library.database);
  async onModuleDestroy() {
    await this.auth.close();
  }

  private async user(
    cookie?: string,
    mutation?: { origin?: string; contentType?: string },
  ) {
    const user = await this.auth.currentUser(sessionToken(cookie));
    if (!user) throw new AuthError('Sign in to access your library.', 401);
    if (mutation) validateAuthRequest(mutation.origin, mutation.contentType);
    return user;
  }

  private async run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof AuthError || error instanceof LibraryError)
        throw new HttpException(error.message, error.status);
      throw error;
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Headers('cookie') cookie: string | undefined,
    @Query('q') q = '',
    @Query('page') page = '1',
  ) {
    return this.run(async () => {
      const user = await this.user(cookie);
      const query = libraryQuery(q, page);
      return this.library.list(user.id, query.search, query.page);
    });
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  async rename(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    return this.run(async () => {
      const user = await this.user(cookie, { origin, contentType });
      return this.library.rename(user.id, id, body);
    });
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  async remove(
    @Param('id') id: string,
    @Headers('cookie') cookie: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    return this.run(async () => {
      const user = await this.user(cookie, { origin, contentType });
      return this.library.remove(user.id, id);
    });
  }
}
