import type { Storage } from "@docx-corpus/shared";

/**
 * Extracted document data from Docling
 */
export interface ExtractedDocument {
  id: string;
  sourceKey: string;
  text: string;
  wordCount: number;
  charCount: number;
  tableCount: number;
  imageCount: number;
  extractedAt: string;
}

/**
 * Configuration for the extraction process
 */
export interface ExtractConfig {
  storage: Storage;
  inputPrefix: string;
  outputPrefix: string;
  batchSize: number;
  workers: number;
  resume: boolean;
}

/**
 * Progress tracking for resumable extraction
 */
export interface ExtractionProgress {
  totalFiles: number;
  processedFiles: number;
  successCount: number;
  errorCount: number;
  lastProcessedKey?: string;
  startedAt: string;
  updatedAt: string;
}
