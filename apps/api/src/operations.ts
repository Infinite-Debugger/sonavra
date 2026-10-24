import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  INestApplication,
  ExceptionFilter,
  ArgumentsHost,
} from '@nestjs/common';
import { HttpException, Injectable } from '@nestjs/common';
import { createDatabase, type PrismaClient } from '@sonavra/database';
import { logEvent, withLogContext } from '@sonavra/config';

function normalizedPath(path: string) {
  return (
    path.split('?')[0]!.replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase() ||
    '/'
  );
}

export function requestCategory(method: string, path: string) {
  path = normalizedPath(path);
  if (method === 'POST' && /^\/auth\/(signup|signin)$/.test(path))
    return { name: 'auth', limit: 10, windowMs: 60_000 };
  if (method === 'POST' && path === '/uploads')
    return { name: 'upload', limit: 10, windowMs: 3600_000 };
  if (method === 'POST' && /\/summary$/.test(path))
    return { name: 'summary', limit: 6, windowMs: 3600_000 };
  if (method === 'POST' && /\/transcription-jobs$/.test(path))
    return { name: 'job', limit: 10, windowMs: 3600_000 };
  return {
    name: method === 'GET' || method === 'HEAD' ? 'read' : 'write',
    limit: method === 'GET' || method === 'HEAD' ? 300 : 60,
    windowMs: 60_000,
  };
}

export class RequestLimiter {
  constructor(
    private readonly database: Pick<PrismaClient, '$queryRaw'>,
    private readonly namespace = 'api',
  ) {}
  async take(client: string, category: ReturnType<typeof requestCategory>) {
    const key = createHash('sha256')
      .update(`${this.namespace}:${client}:${category.name}`)
      .digest('hex');
    const [row] = await this.database.$queryRaw<
      Array<{ hits: number; expiresAt: Date; now: Date }>
    >`
      INSERT INTO "RequestRateLimit" ("key", "hits", "expiresAt")
      VALUES (${key}, 1, CURRENT_TIMESTAMP + (${category.windowMs} * INTERVAL '1 millisecond'))
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RequestRateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST("RequestRateLimit"."hits" + 1, ${category.limit + 1}) END,
        "expiresAt" = CASE WHEN "RequestRateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + (${category.windowMs} * INTERVAL '1 millisecond') ELSE "RequestRateLimit"."expiresAt" END
      RETURNING "hits", "expiresAt", CURRENT_TIMESTAMP AS "now"
    `;
    if (!row) throw new Error('Rate limit unavailable');
    return {
      allowed: row.hits <= category.limit,
      retryAfter: Math.max(
        1,
        Math.ceil((row.expiresAt.getTime() - row.now.getTime()) / 1000),
      ),
    };
  }
}

function clientAddress(request: IncomingMessage, trustProxy: boolean) {
  const peer = request.socket.remoteAddress ?? 'unknown';
  if (trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    const header = request.headers['x-forwarded-for'];
    const first =
      typeof header === 'string' ? header.split(',')[0]?.trim() : undefined;
    if (first && isIP(first)) return first;
  }
  return peer;
}

function safeRoute(path: string) {
  const normalized = path.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, ':id');
  return /^\/(?:health|ready|uploads(?:\/policy|\/:id\/complete)?|auth\/(?:signup|signin|signout|session|claim)|library\/recordings(?:\/:id)?|recordings\/:id\/(?:status|transcript(?:\/(?:segments|speakers)\/:id)?|summary|transcription-jobs)|transcription-jobs\/:id)$/.test(
    normalized,
  )
    ? normalized
    : 'unmatched';
}

export function operationalMiddleware(
  database: Pick<PrismaClient, '$queryRaw'>,
  options: {
    rateLimiting?: boolean;
    trustProxy?: boolean;
    namespace?: string;
  } = {},
) {
  const enabled =
    options.rateLimiting ??
    (process.env.NODE_ENV === 'production' ||
      process.env.SONAVRA_RATE_LIMITING === 'true');
  const trustProxy =
    options.trustProxy ?? process.env.SONAVRA_TRUST_PROXY === 'true';
  const limiter = new RequestLimiter(database, options.namespace);
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const supplied = request.headers['x-request-id'];
    const requestId =
      typeof supplied === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        supplied,
      )
        ? supplied
        : randomUUID();
    const path = normalizedPath(request.url ?? '/');
    const method = request.method ?? 'UNKNOWN';
    const started = performance.now();
    response.setHeader('x-request-id', requestId);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.once('finish', () =>
      logEvent('api', 'request_finished', {
        requestId,
        method,
        route: safeRoute(path),
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    withLogContext({ requestId }, () => {
      const reject = (status: number, message: string) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message, requestId }));
      };
      if (!enabled || path === '/health' || path === '/ready') {
        next();
        return;
      }
      void limiter
        .take(clientAddress(request, trustProxy), requestCategory(method, path))
        .then((result) => {
          if (result.allowed) next();
          else {
            response.setHeader('retry-after', result.retryAfter);
            reject(429, 'Too many requests. Please try again later.');
          }
        })
        .catch(() =>
          reject(
            503,
            'Request controls are temporarily unavailable. Please try again.',
          ),
        );
    });
  };
}

class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const parserStatus =
      error &&
      typeof error === 'object' &&
      'status' in error &&
      [400, 413].includes(Number(error.status))
        ? Number(error.status)
        : 500;
    const status =
      error instanceof HttpException ? error.getStatus() : parserStatus;
    // Known HTTP errors contain deliberate product messages; never log raw errors.
    const payload =
      error instanceof HttpException
        ? error.getResponse()
        : { message: 'The request could not be completed. Please try again.' };
    if (status >= 500) logEvent('api', 'request_failed', { status });
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        typeof payload === 'string' ? { message: payload } : payload,
      ),
    );
  }
}

export function configureOperations(
  app: INestApplication,
  database: Pick<PrismaClient, '$queryRaw'>,
  options?: Parameters<typeof operationalMiddleware>[1],
) {
  app.use(operationalMiddleware(database, options));
  app.useGlobalFilters(new SafeExceptionFilter());
}

@Injectable()
export class OperationalDatabase {
  readonly client = createDatabase();
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
