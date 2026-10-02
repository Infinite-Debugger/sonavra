export interface DatabaseClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
