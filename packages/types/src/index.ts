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
  status: 'UPLOADED';
  expiresAt: string;
}
