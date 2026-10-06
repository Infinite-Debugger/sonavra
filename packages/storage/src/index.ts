import { createHmac, createHash, randomUUID } from 'node:crypto';

export interface PresignedUpload {
  key: string;
  url: string;
  method: 'PUT';
  headers: Readonly<Record<string, string>>;
  expiresAt: Date;
}

export interface PresignedDownload {
  url: string;
  method: 'GET';
  expiresAt: Date;
}

export interface StoredObjectMetadata {
  contentLength: number;
  contentType: string | null;
}

export interface ObjectStorage {
  createObjectKey(): string;
  presignUpload(
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<PresignedUpload>;
  presignDownload(
    key: string,
    expiresInSeconds?: number,
  ): Promise<PresignedDownload>;
  statObject(key: string): Promise<StoredObjectMetadata | null>;
  downloadObject(key: string): Promise<Response>;
  deleteObject(key: string): Promise<void>;
}

export interface S3ObjectStorageOptions {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicEndpoint?: string;
}

const DEFAULT_EXPIRY_SECONDS = 15 * 60;
const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, key?: string) {
  return key
    ? `/${encode(bucket)}/${key.split('/').map(encode).join('/')}`
    : `/${encode(bucket)}`;
}

function amzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function dateStamp(date: Date) {
  return amzDate(date).slice(0, 8);
}

function validateExpiry(expiresInSeconds: number) {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > MAX_EXPIRY_SECONDS
  ) {
    throw new RangeError(
      `expiresInSeconds must be between 1 and ${MAX_EXPIRY_SECONDS}`,
    );
  }
}

function canonicalQuery(parameters: Record<string, string>) {
  return Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly endpoint: URL;
  private readonly publicEndpoint: URL;

  constructor(private readonly options: S3ObjectStorageOptions) {
    this.endpoint = new URL(options.endpoint);
    this.publicEndpoint = new URL(options.publicEndpoint ?? options.endpoint);

    if (
      this.endpoint.pathname !== '/' ||
      this.publicEndpoint.pathname !== '/'
    ) {
      throw new Error('S3 endpoints must not include a path');
    }
  }

  createObjectKey() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `recordings/${year}/${month}/${randomUUID()}`;
  }

  async presignUpload(
    contentType: string,
    expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
  ) {
    if (!contentType.trim()) {
      throw new Error('contentType is required');
    }

    const key = this.createObjectKey();
    const signed = this.presign('PUT', key, expiresInSeconds, {
      'content-type': contentType,
    });
    return {
      key,
      url: signed.url,
      method: 'PUT' as const,
      headers: { 'content-type': contentType },
      expiresAt: signed.expiresAt,
    };
  }

  async presignDownload(
    key: string,
    expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
  ) {
    this.validateKey(key);
    const signed = this.presign('GET', key, expiresInSeconds);
    return {
      url: signed.url,
      method: 'GET' as const,
      expiresAt: signed.expiresAt,
    };
  }

  async statObject(key: string) {
    this.validateKey(key);
    const { url } = this.presign('HEAD', key, 60, {}, this.endpoint);
    const response = await fetch(url, { method: 'HEAD' });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `S3 object metadata failed with status ${response.status}`,
      );
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('S3 object metadata returned an invalid content length');
    }
    return { contentLength, contentType: response.headers.get('content-type') };
  }

  async downloadObject(key: string) {
    this.validateKey(key);
    const { url } = this.presign('GET', key, 60, {}, this.endpoint);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`S3 download failed with status ${response.status}`);
    }
    return response;
  }

  async ensureBucket() {
    const { url } = this.presign('PUT', undefined, 60, {}, this.endpoint);
    const response = await fetch(url, { method: 'PUT' });
    if (!response.ok && response.status !== 409) {
      throw new Error(`S3 bucket setup failed with status ${response.status}`);
    }
  }

  async deleteObject(key: string) {
    this.validateKey(key);
    const { url } = this.presign('DELETE', key, 60, {}, this.endpoint);
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed with status ${response.status}`);
    }
  }

  private validateKey(key: string) {
    if (!key || key.startsWith('/') || key.includes('..')) {
      throw new Error('Invalid object key');
    }
  }

  private presign(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    key: string | undefined,
    expiresInSeconds: number,
    headers: Record<string, string> = {},
    targetEndpoint = this.publicEndpoint,
  ) {
    validateExpiry(expiresInSeconds);
    const now = new Date();
    const timestamp = amzDate(now);
    const day = dateStamp(now);
    const scope = `${day}/${this.options.region}/s3/aws4_request`;
    const host = targetEndpoint.host;
    const signedHeaders = [
      'host',
      ...Object.keys(headers).map((name) => name.toLowerCase()),
    ].sort();
    const canonicalHeaders = signedHeaders
      .map(
        (name) => `${name}:${name === 'host' ? host : headers[name]?.trim()}\n`,
      )
      .join('');

    const parameters: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.options.accessKeyId}/${scope}`,
      'X-Amz-Date': timestamp,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders.join(';'),
    };

    const path = canonicalPath(this.options.bucket, key);
    const query = canonicalQuery(parameters);
    const canonicalRequest = [
      method,
      path,
      query,
      canonicalHeaders,
      signedHeaders.join(';'),
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      scope,
      sha256(canonicalRequest),
    ].join('\n');

    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, day);
    const regionKey = hmac(dateKey, this.options.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');
    const finalQuery = `${query}&X-Amz-Signature=${signature}`;
    const url = new URL(targetEndpoint);
    url.pathname = path;
    url.search = finalQuery;

    return {
      url: url.toString(),
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
    };
  }
}

export function createS3ObjectStorageFromEnv(env = process.env) {
  const required = [
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ] as const;

  for (const name of required) {
    if (!env[name]) {
      throw new Error(`${name} is required`);
    }
  }

  return new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT!,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    bucket: env.S3_BUCKET!,
    region: env.S3_REGION!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  });
}
