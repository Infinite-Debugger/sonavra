import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hashPassword,
  verifyPassword,
  validateCredentials,
  sessionToken,
  sessionCookie,
  validateAuthRequest,
  authOrigin,
} from './auth.js';

describe('account authentication', () => {
  it('normalizes email without altering passwords', () => {
    assert.deepEqual(
      validateCredentials({
        email: ' Ada@Example.com ',
        password: ' a long password ',
      }),
      { email: 'ada@example.com', password: ' a long password ' },
    );
    for (const body of [
      null,
      {},
      { email: 'not-email', password: 'a long password' },
      { email: 'ada@example.com', password: 'short' },
      { email: 'ada@example.com', password: 'x'.repeat(129) },
    ]) {
      assert.throws(() => validateCredentials(body));
    }
  });

  it('salts password hashes and rejects incorrect or missing credentials', async () => {
    const first = await hashPassword('a long password');
    const second = await hashPassword('a long password');
    assert.notEqual(first, second);
    assert.equal(await verifyPassword('a long password', first), true);
    assert.equal(await verifyPassword('a wrong password', first), false);
    assert.equal(await verifyPassword('a long password', null), false);
    assert.equal(await verifyPassword('a long password', 'invalid'), false);
  });

  it('only parses the account cookie and rejects malformed tokens', () => {
    const token = 'a'.repeat(64);
    assert.equal(
      sessionToken(
        `other=value; sonavraAccountSession=${token}; guest=unchanged`,
      ),
      token,
    );
    assert.equal(
      sessionToken(`otherSonavraAccountSession=${token}`),
      undefined,
    );
    assert.equal(sessionToken('sonavraAccountSession=%0D%0Aheader'), undefined);
    assert.equal(sessionToken(), undefined);
    assert.match(
      sessionCookie(token),
      /HttpOnly; SameSite=Lax; Max-Age=2592000/,
    );
    assert.match(sessionCookie(), /Max-Age=0/);
  });

  it('rejects cross-origin and non-JSON mutations', () => {
    assert.doesNotThrow(() =>
      validateAuthRequest(authOrigin(), 'application/json; charset=utf-8'),
    );
    assert.throws(() =>
      validateAuthRequest('https://untrusted.example', 'application/json'),
    );
    assert.throws(() => validateAuthRequest(undefined, 'application/json'));
    assert.throws(() =>
      validateAuthRequest(authOrigin(), 'application/x-www-form-urlencoded'),
    );
  });

  it('requires a configured HTTPS origin for production cookies', () => {
    const previousOrigin = process.env.AUTH_ORIGIN;
    const previousMode = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_ORIGIN = 'http://localhost:3000';
      assert.throws(authOrigin, /HTTPS/);
      process.env.AUTH_ORIGIN = 'https://sonavra.example';
      assert.match(sessionCookie('a'.repeat(64)), /; Secure$/);
      assert.match(sessionCookie(), /; Secure$/);
      process.env.AUTH_ORIGIN = 'https://sonavra.example/';
      assert.throws(authOrigin);
    } finally {
      if (previousOrigin === undefined) delete process.env.AUTH_ORIGIN;
      else process.env.AUTH_ORIGIN = previousOrigin;
      if (previousMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousMode;
    }
  });
});
