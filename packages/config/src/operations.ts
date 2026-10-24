import { timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export type LogContext = {
  requestId?: string;
  recordingId?: string;
  jobId?: string;
};
const context = new AsyncLocalStorage<LogContext>();
export const logContext = () => context.getStore() ?? {};
export function withLogContext<T>(fields: LogContext, action: () => T): T {
  return context.run(fields, action);
}
export function logEvent(
  service: 'api' | 'worker' | 'runtime',
  event: string,
  fields: {
    method?: string;
    route?: string;
    status?: number | string;
    durationMs?: number;
    errorCode?: string;
    attemptCount?: number;
    deleted?: number;
    failed?: number;
    sessions?: number;
    cpuMs?: number;
    peakMemoryBytes?: number;
    gpuMemoryBytes?: number;
  } & LogContext = {},
) {
  const all = { ...logContext(), ...fields };
  const ids = new Set(['requestId', 'recordingId', 'jobId']);
  const numbers = new Set([
    'durationMs',
    'attemptCount',
    'deleted',
    'failed',
    'sessions',
    'cpuMs',
    'peakMemoryBytes',
    'gpuMemoryBytes',
  ]);
  const labels = new Set(['method', 'route', 'status', 'errorCode']);
  const safe = Object.fromEntries(
    Object.entries(all).filter(
      ([key, value]) =>
        (ids.has(key) &&
          typeof value === 'string' &&
          /^[a-f0-9-]{36}$/i.test(value)) ||
        (numbers.has(key) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0) ||
        (labels.has(key) &&
          (typeof value === 'number' ||
            (typeof value === 'string' &&
              value.length <= 200 &&
              /^[a-z0-9_/:,.-]+$/i.test(value)))),
    ),
  );
  console.log(
    JSON.stringify({ time: new Date().toISOString(), service, event, ...safe }),
  );
}

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super(`Invalid configuration: ${fields.join(', ')}`);
  }
}
export function positiveInteger(
  name: string,
  fallback: number,
  env = process.env,
) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ConfigurationError([name]);
  return value;
}
export function validateProductionConfiguration(
  service: 'api' | 'worker',
  env = process.env,
) {
  if (env.NODE_ENV !== 'production') return;
  const required = [
    'DATABASE_URL',
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'SONAVRA_HEALTH_TOKEN',
  ];
  if (service === 'api') required.push('AUTH_ORIGIN', 'S3_PUBLIC_ENDPOINT');
  else
    required.push(
      'SONAVRA_TRANSCRIPTION_MODEL',
      'SONAVRA_DIARIZATION_MODEL',
      'SONAVRA_TRANSCRIPTION_RUNTIME_CONTAINER',
    );
  const invalid = required.filter((key) => !env[key]?.trim());
  if (!/^[a-z0-9_-]{32,}$/i.test(env.SONAVRA_HEALTH_TOKEN ?? ''))
    invalid.push('SONAVRA_HEALTH_TOKEN');
  if (env.S3_ACCESS_KEY_ID === 'sonavra') invalid.push('S3_ACCESS_KEY_ID');
  if (env.S3_SECRET_ACCESS_KEY === 'sonavra-local-secret')
    invalid.push('S3_SECRET_ACCESS_KEY');
  try {
    const db = new URL(env.DATABASE_URL!);
    if (
      !['postgres:', 'postgresql:'].includes(db.protocol) ||
      !db.password ||
      db.password === 'sonavra'
    )
      invalid.push('DATABASE_URL');
  } catch {
    invalid.push('DATABASE_URL');
  }
  try {
    const storage = new URL(env.S3_ENDPOINT!);
    if (
      !['http:', 'https:'].includes(storage.protocol) ||
      storage.username ||
      storage.password
    )
      invalid.push('S3_ENDPOINT');
  } catch {
    invalid.push('S3_ENDPOINT');
  }
  if (service === 'api') {
    try {
      const origin = new URL(env.AUTH_ORIGIN!);
      const media = new URL(env.S3_PUBLIC_ENDPOINT!);
      if (origin.protocol !== 'https:' || origin.origin !== env.AUTH_ORIGIN)
        invalid.push('AUTH_ORIGIN');
      if (media.origin !== origin.origin || media.href !== `${media.origin}/`)
        invalid.push('S3_PUBLIC_ENDPOINT');
    } catch {
      invalid.push('AUTH_ORIGIN', 'S3_PUBLIC_ENDPOINT');
    }
    if (!['127.0.0.1', '::1'].includes(env.API_HOST ?? '127.0.0.1'))
      invalid.push('API_HOST');
  } else if (!env.SONAVRA_DIARIZATION_MODEL?.startsWith('/'))
    invalid.push('SONAVRA_DIARIZATION_MODEL');
  if (invalid.length) throw new ConfigurationError([...new Set(invalid)]);
}

export function healthAuthorized(
  authorization: string | undefined,
  token = process.env.SONAVRA_HEALTH_TOKEN,
) {
  if (!token || !authorization) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicTranscriptionError(code?: string | null) {
  return code === 'media_error'
    ? 'The media could not be processed or exceeds the duration limit.'
    : 'The self-hosted transcription could not be completed. Please try again.';
}
