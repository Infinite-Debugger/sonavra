import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  validateUploadInput,
} from './uploads.js';

describe('public upload validation', () => {
  it('accepts OGG media', () => {
    assert.deepEqual(
      validateUploadInput({
        filename: 'meeting.ogg',
        mimeType: 'audio/ogg',
        sizeBytes: 1024,
      }),
      {
        filename: 'meeting.ogg',
        mimeType: 'audio/ogg',
        sizeBytes: 1024,
      },
    );
  });

  it('rejects unsupported media', () => {
    assert.throws(
      () =>
        validateUploadInput({
          filename: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
        }),
      UploadValidationError,
    );
  });

  it('rejects oversized media', () => {
    assert.throws(
      () =>
        validateUploadInput({
          filename: 'huge.ogg',
          mimeType: 'audio/ogg',
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        }),
      /500 MB/,
    );
  });
});

describe('guest retention configuration', () => {
  it('defaults to 24 hours and rejects invalid windows', async () => {
    const { guestRetentionHours } = await import('@sonavra/config');
    assert.equal(guestRetentionHours('24'), 24);
    assert.equal(guestRetentionHours('48'), 48);
    for (const value of ['', '0', '-1', '1.5', 'invalid', '8761']) {
      assert.throws(
        () => guestRetentionHours(value),
        /SONAVRA_GUEST_RETENTION_HOURS/,
      );
    }
  });
});
