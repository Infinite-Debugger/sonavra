import assert from 'node:assert/strict';
import test from 'node:test';
import { S3ObjectStorage } from './index.js';

const options = {
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  bucket: process.env.S3_BUCKET ?? 'sonavra',
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'sonavra',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'sonavra-local-secret',
};

test('generates opaque recording keys without caller PII', () => {
  const storage = new S3ObjectStorage(options);
  const first = storage.createObjectKey();
  const second = storage.createObjectKey();

  assert.match(first, /^recordings\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes('@'), false);
});

test('presigns browser uploads with content type and bounded expiry', async () => {
  const storage = new S3ObjectStorage(options);
  const upload = await storage.presignUpload('audio/mpeg', 300);
  const url = new URL(upload.url);

  assert.equal(upload.method, 'PUT');
  assert.deepEqual(upload.headers, { 'content-type': 'audio/mpeg' });
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(
    url.searchParams.get('X-Amz-SignedHeaders'),
    'content-type;host',
  );
  assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);

  await assert.rejects(
    () => storage.presignUpload('audio/mpeg', 604801),
    RangeError,
  );
});

test('presigns private retrieval instead of exposing a public object URL', async () => {
  const storage = new S3ObjectStorage(options);
  const download = await storage.presignDownload(
    'recordings/2026/10/example',
    60,
  );
  const url = new URL(download.url);

  assert.equal(download.method, 'GET');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
  assert.ok(url.searchParams.has('X-Amz-Signature'));
});

test(
  'uploads, retrieves and deletes through a real S3-compatible service',
  { skip: process.env.STORAGE_INTEGRATION !== '1' },
  async () => {
    const storage = new S3ObjectStorage(options);
    const body = Buffer.from('sonavra-storage-integration');
    const upload = await storage.presignUpload('audio/wav', 60);

    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body,
    });
    assert.equal(put.status, 200);

    const anonymous = await fetch(
      `${options.endpoint}/${options.bucket}/${upload.key}`,
    );
    assert.equal(anonymous.status, 403);

    const download = await storage.presignDownload(upload.key, 60);
    const get = await fetch(download.url);
    assert.equal(get.status, 200);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), body);

    await storage.deleteObject(upload.key);
    const afterDelete = await fetch(
      (await storage.presignDownload(upload.key, 60)).url,
    );
    assert.equal(afterDelete.status, 404);
  },
);
