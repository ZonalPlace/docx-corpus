import type { Storage } from "@docx-corpus/shared";

/**
 * Supported embedding models
 */
export type EmbeddingModel = "minilm" | "bge-m3" | "voyage-lite";

/**
 * Embedded document with vector
 */
export interface EmbeddedDocument {
  id: string;
  embedding: number[];
  model: EmbeddingModel;
  dimensions: number;
  embeddedAt: string;
}

/**
 * Index entry for tracking (without the full embedding)
 */
export interface EmbeddingIndexEntry {
  id: string;
  model: EmbeddingModel;
  dimensions: number;
  embeddedAt: string;
}

/**
 * Configuration for the embedding process
 */
export interface EmbedConfig {
  storage: Storage;
  inputPrefix: string;
  outputPrefix: string;
  model: EmbeddingModel;
  batchSize: number;
  workers: number;
}
