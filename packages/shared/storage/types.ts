/**
 * Storage abstraction for reading/writing files to local filesystem or R2.
 */

export interface StorageReader {
  /** Read file contents, returns null if not found */
  read(key: string): Promise<Uint8Array | null>;

  /** Check if file exists */
  exists(key: string): Promise<boolean>;

  /** List files matching prefix, yields keys */
  list(prefix: string): AsyncIterable<string>;
}

export interface StorageWriter {
  /** Write file contents (overwrites if exists) */
  write(key: string, content: Uint8Array | string): Promise<void>;

  /** Write file only if it doesn't exist, returns true if written */
  writeIfNotExists(key: string, content: Uint8Array): Promise<boolean>;
}

export interface Storage extends StorageReader, StorageWriter {}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}
