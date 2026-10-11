import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@sonavra/database';
import { AuthController } from './auth.controller.js';
import { authOrigin, tokenHash } from './auth.js';

@Module({ controllers: [AuthController] })
class TestAuthModule {}

describe(
  'account HTTP and database integration',
  { skip: !process.env.DATABASE_URL },
  () => {
    it('protects accounts, rotates and revokes sessions, and preserves guest work', async () => {
      const database = createDatabase();
      const email = `auth-test-${randomUUID()}@example.com`;
      const password = 'test account password';
      const app = await NestFactory.create(TestAuthModule, { logger: false });
      let guestId: string | undefined;
      try {
        await app.listen(0, '127.0.0.1');
        const url = await app.getUrl();
        const request = (
          path: string,
          cookie = '',
          body?: unknown,
          origin = authOrigin(),
        ) =>
          fetch(`${url}/auth/${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { cookie, origin, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        assert.equal((await request('account')).status, 401);
        assert.deepEqual(await (await request('session')).json(), {
          user: null,
        });
        assert.equal(
          (
            await request(
              'signup',
              '',
              { email, password },
              'https://untrusted.example',
            )
          ).status,
          403,
        );
        assert.equal(
          (await request('signup', '', { email, password: 'short' })).status,
          400,
        );

        const guest = await database.guestSession.create({
          data: {
            expiresAt: new Date(Date.now() + 86400000),
            recordings: {
              create: {
                originalFilename: 'auth-test.ogg',
                objectKey: `auth-test/${randomUUID()}`,
                mimeType: 'audio/ogg',
                sizeBytes: 12,
                status: 'UPLOADED',
              },
            },
          },
          include: { recordings: true },
        });
        guestId = guest.id;
        const recording = guest.recordings[0]!;

        const signup = await request('signup', '', {
          email: email.toUpperCase(),
          password,
        });
        assert.equal(signup.status, 201);
        assert.equal(signup.headers.get('cache-control'), 'no-store');
        const firstCookie = signup.headers.get('set-cookie')!.split(';')[0]!;
        assert.match(
          signup.headers.get('set-cookie')!,
          /HttpOnly; SameSite=Lax/,
        );
        const { user } = (await signup.json()) as {
          user: { id: string; email: string };
        };
        assert.deepEqual(Object.keys(user).sort(), ['email', 'id']);
        assert.equal(user.email, email);
        const stored = await database.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        assert.notEqual(stored.passwordHash, password);
        const token = firstCookie.split('=')[1]!;
        const session = await database.accountSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(token) },
        });
        assert.notEqual(session.tokenHash, token);
        assert.deepEqual(await (await request('account', firstCookie)).json(), {
          user,
        });
        assert.equal(
          (await request('signup', '', { email, password })).status,
          409,
        );
        assert.equal(
          (
            await request('signin', '', {
              email,
              password: 'incorrect password',
            })
          ).status,
          401,
        );
        assert.equal(
          (await request('signin', '', { email: `absent-${email}`, password }))
            .status,
          401,
        );
        assert.equal(
          (await request('account', `sonavraAccountSession=${'b'.repeat(64)}`))
            .status,
          401,
        );

        const signin = await request('signin', firstCookie, {
          email,
          password,
        });
        assert.equal(signin.status, 200);
        const secondCookie = signin.headers.get('set-cookie')!.split(';')[0]!;
        assert.notEqual(firstCookie, secondCookie);
        assert.equal((await request('account', firstCookie)).status, 401);
        assert.equal((await request('account', secondCookie)).status, 200);
        assert.equal(
          (
            await request(
              'signout',
              secondCookie,
              {},
              'https://untrusted.example',
            )
          ).status,
          403,
        );
        assert.equal((await request('account', secondCookie)).status, 200);
        const signout = await request('signout', secondCookie, {});
        assert.equal(signout.status, 200);
        assert.match(signout.headers.get('set-cookie')!, /Max-Age=0/);
        assert.equal((await request('account', secondCookie)).status, 401);
        assert.equal((await request('signout', secondCookie, {})).status, 200);

        const expiredLogin = await request('signin', '', { email, password });
        const expiredCookie = expiredLogin.headers
          .get('set-cookie')!
          .split(';')[0]!;
        await database.accountSession.updateMany({
          where: { userId: user.id },
          data: { expiresAt: new Date(0) },
        });
        assert.equal((await request('account', expiredCookie)).status, 401);
        assert.deepEqual(
          await (await request('session', expiredCookie)).json(),
          { user: null },
        );
        const unchanged = await database.recording.findUniqueOrThrow({
          where: { id: recording.id },
        });
        assert.equal(unchanged.guestSessionId, guest.id);
        assert.equal(unchanged.userId, null);
        assert.equal(unchanged.status, 'UPLOADED');
      } finally {
        await app.close();
        await database.user.deleteMany({ where: { email } });
        if (guestId)
          await database.guestSession.deleteMany({ where: { id: guestId } });
        await database.$disconnect();
      }
    });
  },
);
