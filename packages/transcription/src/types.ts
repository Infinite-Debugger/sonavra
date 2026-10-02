export type TranscriptionSource =
  | {
      kind: 'file';
      path: string;
    }
  | {
      kind: 'url';
      url: string;
    };

export interface TranscriptionRequest {
  source: TranscriptionSource;
  language?: string;
  detectLanguage?: boolean;
  diarization?: boolean;
}

export interface TranscriptSpeaker {
  id: string;
  label: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
  confidence?: number;
}

export interface TranscriptionResult {
  engine: string;
  language?: string;
  durationMs?: number;
  speakers: TranscriptSpeaker[];
  segments: TranscriptSegment[];
}

export interface TranscriptionEngine {
  readonly name: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
