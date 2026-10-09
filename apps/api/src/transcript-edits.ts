export const MAX_SEGMENT_TEXT_LENGTH = 20_000;
export const MAX_SPEAKER_NAME_LENGTH = 100;

export class TranscriptEditValidationError extends Error {}

export function normalizeSegmentText(value: unknown) {
  if (typeof value !== 'string') {
    throw new TranscriptEditValidationError('Transcript text is required.');
  }

  const text = value.trim();
  if (!text) {
    throw new TranscriptEditValidationError('Transcript text cannot be empty.');
  }
  if (text.length > MAX_SEGMENT_TEXT_LENGTH) {
    throw new TranscriptEditValidationError('Transcript text is too long.');
  }
  return text;
}

export function normalizeSpeakerName(value: unknown) {
  if (typeof value !== 'string') {
    throw new TranscriptEditValidationError('Speaker name is required.');
  }

  const displayName = value.trim();
  if (!displayName) {
    throw new TranscriptEditValidationError('Speaker name cannot be empty.');
  }
  if (displayName.length > MAX_SPEAKER_NAME_LENGTH) {
    throw new TranscriptEditValidationError('Speaker name is too long.');
  }
  return displayName;
}
