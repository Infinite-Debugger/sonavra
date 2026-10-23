import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import {
  ConfigurationError,
  healthAuthorized,
  logEvent,
  validateProductionConfiguration,
  withLogContext,
} from '@sonavra/config';
import { randomUUID } from 'node:crypto';

const configuration = {
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://deploy:synthetic-password-for-tests@localhost/sonavra',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'sonavra',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'synthetic-key',
  S3_SECRET_ACCESS_KEY: 'synthetic-secret-for-tests',
  AUTH_ORIGIN: 'https://sonavra.example',
  S3_PUBLIC_ENDPOINT: 'https://sonavra.example',
  SONAVRA_HEALTH_TOKEN: 'h'.repeat(32),
  SONAVRA_TRANSCRIPTION_MODEL: 'small',
  SONAVRA_DIARIZATION_MODEL: '/models/diarization',
  SONAVRA_TRANSCRIPTION_RUNTIME_CONTAINER: 'sonavra-transcription-runtime',
};

test('production requires private ingress and explicit configuration without exposing values', () => {
  assert.doesNotThrow(() =>
    validateProductionConfiguration('api', configuration),
  );
  assert.doesNotThrow(() =>
    validateProductionConfiguration('worker', configuration),
  );
  for (const [key, value] of Object.entries({
    DATABASE_URL: '',
    S3_SECRET_ACCESS_KEY: 'sonavra-local-secret',
    SONAVRA_HEALTH_TOKEN: 'short',
    AUTH_ORIGIN: 'http://sonavra.example',
    S3_PUBLIC_ENDPOINT: 'https://storage.example',
    API_HOST: '0.0.0.0',
  })) {
    assert.throws(
      () =>
        validateProductionConfiguration('api', {
          ...configuration,
          [key]: value,
        }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.fields.includes(key) &&
        !error.message.includes('synthetic-password'),
    );
  }
  assert.throws(
    () =>
      validateProductionConfiguration('worker', {
        ...configuration,
        SONAVRA_DIARIZATION_MODEL: '',
      }),
    ConfigurationError,
  );
  assert.equal(
    healthAuthorized(
      `Bearer ${configuration.SONAVRA_HEALTH_TOKEN}`,
      configuration.SONAVRA_HEALTH_TOKEN,
    ),
    true,
  );
  assert.equal(
    healthAuthorized('Bearer wrong', configuration.SONAVRA_HEALTH_TOKEN),
    false,
  );
});

test('structured logs allow only safe fields and preserve independent asynchronous correlation', async () => {
  const lines: string[] = [];
  const logger = mock.method(console, 'log', (value: unknown) => {
    lines.push(String(value));
  });
  try {
    const ids = [randomUUID(), randomUUID()];
    await Promise.all(
      ids.map((requestId) =>
        withLogContext({ requestId }, async () => {
          await Promise.resolve();
          logEvent('api', 'test', {
            status: 200,
            ...({
              transcript: 'private text',
              cookie: 'private cookie',
            } as object),
          });
        }),
      ),
    );
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).requestId).sort(),
      ids.sort(),
    );
    assert.doesNotMatch(lines.join('\n'), /private|transcript|cookie/);
  } finally {
    logger.mock.restore();
  }
});
