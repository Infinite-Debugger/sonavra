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
