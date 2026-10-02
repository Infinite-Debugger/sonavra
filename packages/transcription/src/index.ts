export interface TranscriptionInput {
  objectKey: string;
  language?: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface Transcript {
  language?: string;
  segments: TranscriptSegment[];
}

export type TranscriptionErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_MEDIA'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TRANSCRIPTION_FAILED';

export class TranscriptionError extends Error {
  constructor(
    public readonly code: TranscriptionErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TranscriptionError';
  }
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<Transcript>;
}
