import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createDatabase, type PrismaClient } from '@sonavra/database';
import {
  claimGuestRecordings,
  guestSessionFrom,
  GuestClaimValidationError,
} from './guest-claims.js';

export const SESSION_COOKIE = 'sonavraAccountSession';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

export function validateCredentials(body: unknown) {
  if (!body || typeof body !== 'object')
    throw new AuthError('Email and password are required.');
  const { email, password } = body as Record<string, unknown>;
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    throw new AuthError('Enter a valid email address.');
  }
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128
  ) {
    throw new AuthError('Use a password between 12 and 128 characters.');
  }
  return { email: email.trim().toLowerCase(), password };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split(':');
  const valid =
    parts?.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1] ?? '') &&
    /^[a-f0-9]{128}$/.test(parts[2] ?? '');
  // Missing credentials still incur the same key-derivation cost.
  const salt = valid ? parts![1]! : '0'.repeat(32);
  const expected = Buffer.from(valid ? parts![2]! : '0'.repeat(128), 'hex');
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}

export function sessionToken(cookie?: string) {
  const value = cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function authOrigin() {
  const value =
    process.env.AUTH_ORIGIN ??
    `http://localhost:${process.env.WEB_PORT ?? '3000'}`;
  const url = new URL(value);
  if (
    url.origin !== value ||
    !['http:', 'https:'].includes(url.protocol) ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  ) {
    throw new Error(
      'AUTH_ORIGIN must be an origin URL and use HTTPS in production',
    );
  }
  return value;
}

export function validateAuthRequest(origin?: string, contentType?: string) {
  if (origin !== authOrigin())
    throw new AuthError('Request origin is not allowed.', 403);
  if (contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new AuthError('JSON request required.', 415);
  }
}

export function sessionCookie(token?: string) {
  return `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_SECONDS : 0}${authOrigin().startsWith('https:') ? '; Secure' : ''}`;
}

export class AuthService {
  constructor(private readonly database: PrismaClient = createDatabase()) {}

  async close() {
    await this.database.$disconnect();
  }

  async signUp(body: unknown, previousToken?: string) {
    const { email, password } = validateCredentials(body);
    const guestSessionId = guestSessionFrom(body);
    const passwordHash = await hashPassword(password);
    const token = randomBytes(32).toString('hex');
    try {
      const result = await this.database.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            sessions: {
              create: {
                tokenHash: tokenHash(token),
                expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
              },
            },
          },
          select: { id: true, email: true },
        });
        if (previousToken)
          await tx.accountSession.deleteMany({
            where: { tokenHash: tokenHash(previousToken) },
          });
        const claim = guestSessionId
          ? await claimGuestRecordings(tx, user.id, guestSessionId)
          : { claimedCount: 0 };
        return { user, ...claim };
      });
      return { ...result, token };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002')
        throw new AuthError('An account with this email already exists.', 409);
      throw error;
    }
  }

  async signIn(body: unknown, previousToken?: string) {
    const { email, password } = validateCredentials(body);
    const user = await this.database.user.findUnique({ where: { email } });
    if (
      !(await verifyPassword(password, user?.passwordHash ?? null)) ||
      !user
    ) {
      throw new AuthError('Email or password is incorrect.', 401);
    }
    const token = randomBytes(32).toString('hex');
    await this.database.$transaction(async (tx) => {
      await tx.accountSession.create({
        data: {
          userId: user.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
        },
      });
      if (previousToken)
        await tx.accountSession.deleteMany({
          where: { tokenHash: tokenHash(previousToken) },
        });
    });
    return { user: { id: user.id, email: user.email }, token };
  }

  async currentUser(token?: string) {
    if (!token) return null;
    const session = await this.database.accountSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    return session.user;
  }

  async claimGuestWork(token: string | undefined, body: unknown) {
    const user = await this.currentUser(token);
    if (!user) throw new AuthError('Sign in to keep your recordings.', 401);
    const guestSessionId = guestSessionFrom(body);
    if (!guestSessionId)
      throw new GuestClaimValidationError('A valid guest session is required.');
    return claimGuestRecordings(this.database, user.id, guestSessionId);
  }

  async signOut(token?: string) {
    if (token)
      await this.database.accountSession.deleteMany({
        where: { tokenHash: tokenHash(token) },
      });
  }
}
