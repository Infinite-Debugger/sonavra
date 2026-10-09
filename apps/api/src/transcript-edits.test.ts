import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSegmentText,
  normalizeSpeakerName,
  TranscriptEditValidationError,
} from './transcript-edits.js';

describe('transcript edit validation', () => {
  it('normalizes transcript text', () => {
    assert.equal(
      normalizeSegmentText('  corrected words  '),
      'corrected words',
    );
  });

  it('rejects empty transcript text', () => {
    assert.throws(
      () => normalizeSegmentText('   '),
      TranscriptEditValidationError,
    );
  });

  it('normalizes speaker names', () => {
    assert.equal(normalizeSpeakerName('  Ronald  '), 'Ronald');
  });

  it('rejects empty speaker names', () => {
    assert.throws(
      () => normalizeSpeakerName(''),
      TranscriptEditValidationError,
    );
  });
});
