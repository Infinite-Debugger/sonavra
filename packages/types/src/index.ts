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
  'UPLOADING' | 'UPLOADED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface RecordingStatusResponse {
  recordingId: string;
  status: RecordingJourneyStatus;
  jobId: string | null;
  retryable: boolean;
  errorMessage: string | null;
  ownership: 'guest' | 'account';
  canClaim: boolean;
  expiresAt: string | null;
}

export interface TranscriptResponse {
  recordingId: string;
  filename: string;
  title?: string | null;
  language: string | null;
  durationMs: number | null;
  media: {
    url: string;
    mimeType: string;
    expiresAt: string;
  };
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

export interface UpdateTranscriptSegmentRequest {
  guestSessionId?: string;
  text: string;
}

export interface UpdateTranscriptSpeakerRequest {
  guestSessionId?: string;
  displayName: string;
}
export type AccountUser = { id: string; email: string };
export type AccountSessionResponse = { user: AccountUser | null };
export type GuestClaimResponse = { claimedCount: number };
export interface LibraryItem {
  id: string;
  title: string;
  originalFilename: string;
  status: RecordingJourneyStatus;
  createdAt: string;
  deletionPending: boolean;
}
export interface LibraryResponse {
  items: LibraryItem[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface TranscriptSummaryResponse {
  available: boolean;
  summary: {
    text: string;
    keyPoints: string[];
    actionItems: string[];
    generatedAt: string;
    stale: boolean;
  } | null;
}
