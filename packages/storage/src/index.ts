export interface ObjectStorage {
  deleteObject(key: string): Promise<void>;
}
