export interface PutResult {
  url: string;
}

export interface StorageService {
  put(key: string, body: Buffer, mime: string): Promise<PutResult>;
}

export const STORAGE_SERVICE = Symbol("STORAGE_SERVICE");
