export type TranscriptionErrorCode =
  | 'invalid_request'
  | 'media_error'
  | 'model_unavailable'
  | 'runtime_unavailable'
  | 'resource_exhausted'
  | 'transcription_failed'
  | 'invalid_response';

export interface TranscriptionEngineErrorOptions {
  code: TranscriptionErrorCode;
  retryable: boolean;
  engine: string;
  cause?: unknown;
}

export class TranscriptionEngineError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly retryable: boolean;
  readonly engine: string;

  constructor(message: string, options: TranscriptionEngineErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'TranscriptionEngineError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.engine = options.engine;
  }
}
