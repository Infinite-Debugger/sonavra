export interface TranscriptionInput {
  objectKey: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface Transcript {
  segments: TranscriptSegment[];
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<Transcript>;
}
