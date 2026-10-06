export type ServiceStatus = 'ready' | 'processing' | 'unavailable';

export interface CreateUploadRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  guestSessionId?: string;
}
export interface CreateUploadResponse {
  recordingId: string;
  guestSessionId: string;
  expiresAt: string;
  upload: {
    url: string;
    method: 'PUT';
    headers: Readonly<Record<string, string>>;
    expiresAt: string;
  };
}
export interface CompleteUploadRequest {
  guestSessionId: string;
}
export interface CompleteUploadResponse {
  recordingId: string;
  status: 'QUEUED';
  expiresAt: string;
}

export type RecordingJourneyStatus =
  | 'UPLOADING'
  | 'UPLOADED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface RecordingStatusResponse {
  recordingId: string;
  status: RecordingJourneyStatus;
  jobId: string | null;
  retryable: boolean;
  errorMessage: string | null;
}

export interface TranscriptResponse {
  recordingId: string;
  filename: string;
  language: string | null;
  durationMs: number | null;
  speakers: Array<{
    id: string;
    label: string;
    displayName: string | null;
  }>;
  segments: Array<{
    id: string;
    sequence: number;
    startMs: number;
    endMs: number;
    text: string;
    speakerId: string | null;
  }>;
}
