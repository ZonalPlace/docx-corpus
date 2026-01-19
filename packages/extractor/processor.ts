import { mkdir, rm } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { ExtractConfig, ExtractedDocument, ExtractionProgress } from "./types";

const PYTHON_DIR = join(dirname(import.meta.path), "python");
const PYTHON_PATH = join(PYTHON_DIR, ".venv", "bin", "python");
const SCRIPT_PATH = join(PYTHON_DIR, "extract.py");

const PROGRESS_FILE = "progress.json";
const ERRORS_FILE = "errors.jsonl";
const OUTPUT_FILE = "documents.jsonl";

export async function processDirectory(
  config: ExtractConfig,
  verbose: boolean = false
): Promise<void> {
  const { storage, inputPrefix, outputPrefix } = config;

  // List all .docx files in input prefix
  const files: string[] = [];
  for await (const key of storage.list(inputPrefix)) {
    if (key.toLowerCase().endsWith(".docx") && !basename(key).startsWith("~$")) {
      files.push(key);
    }
  }
  files.sort();

  if (files.length === 0) {
    console.log(`No DOCX files found in ${inputPrefix}`);
    return;
  }

  console.log(`Found ${files.length} DOCX files`);

  // Load progress
  const progress = await loadProgress(storage, outputPrefix);
  const startIndex = config.resume ? progress.processedFiles : 0;

  if (config.resume && startIndex > 0) {
    console.log(`Resuming from file ${startIndex + 1}`);
  }

  progress.totalFiles = files.length;
  progress.startedAt = progress.startedAt || new Date().toISOString();

  // Create temp directory for processing
  const tempDir = join(tmpdir(), `docx-extract-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  // Collect output lines in memory, write at end
  const outputLines: string[] = [];

  // Load existing output if resuming
  if (config.resume && startIndex > 0) {
    const existingOutput = await storage.read(`${outputPrefix}/${OUTPUT_FILE}`);
    if (existingOutput) {
      const text = new TextDecoder().decode(existingOutput);
      outputLines.push(...text.trim().split("\n").filter(Boolean));
    }
  }

  const batches = chunkArray(files.slice(startIndex), config.batchSize);
  let totalProcessed = startIndex;

  try {
    for (const batch of batches) {
      const results = await processBatch(batch, storage, tempDir, config.workers, verbose);

      for (const result of results) {
        if (result.success && result.document) {
          outputLines.push(JSON.stringify(result.document));
          progress.successCount++;
        } else {
          progress.errorCount++;
          await appendError(storage, outputPrefix, result.error || "Unknown error", result.sourceKey);
        }
      }

      totalProcessed += batch.length;
      progress.processedFiles = totalProcessed;
      progress.lastProcessedKey = batch[batch.length - 1];
      progress.updatedAt = new Date().toISOString();

      // Save progress and output
      await saveProgress(storage, outputPrefix, progress);
      await storage.write(
        `${outputPrefix}/${OUTPUT_FILE}`,
        outputLines.join("\n") + "\n"
      );

      const percent = ((totalProcessed / files.length) * 100).toFixed(1);
      console.log(
        `Progress: ${totalProcessed}/${files.length} (${percent}%) - ` +
          `Success: ${progress.successCount}, Errors: ${progress.errorCount}`
      );
    }
  } finally {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log("\nExtraction complete!");
  console.log(`  Total: ${files.length}`);
  console.log(`  Success: ${progress.successCount}`);
  console.log(`  Errors: ${progress.errorCount}`);
  console.log(`  Output: ${outputPrefix}/${OUTPUT_FILE}`);
}

interface ProcessResult {
  sourceKey: string;
  success: boolean;
  document?: ExtractedDocument;
  error?: string;
}

async function extractWithPython(
  sourceKey: string,
  localFilePath: string
): Promise<ExtractedDocument> {
  const proc = Bun.spawn([PYTHON_PATH, SCRIPT_PATH, localFilePath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const errorData = stderr ? JSON.parse(stderr) : { error: "Unknown error" };
    throw new Error(errorData.error || "Python extraction failed");
  }

  const result = JSON.parse(stdout);
  const id = generateId(sourceKey);

  return {
    id,
    sourceKey,
    text: result.text,
    wordCount: result.wordCount,
    charCount: result.charCount,
    tableCount: result.tableCount,
    imageCount: result.imageCount,
    extractedAt: new Date().toISOString(),
  };
}

async function processBatch(
  keys: string[],
  storage: ExtractConfig["storage"],
  tempDir: string,
  workers: number,
  verbose: boolean
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  const queue = [...keys];

  const processFile = async (): Promise<void> => {
    while (queue.length > 0) {
      const sourceKey = queue.shift();
      if (!sourceKey) continue;

      try {
        // Download file from storage to temp
        const content = await storage.read(sourceKey);
        if (!content) {
          throw new Error(`File not found: ${sourceKey}`);
        }

        const tempFile = join(tempDir, `${generateId(sourceKey)}.docx`);
        await Bun.write(tempFile, content);

        // Extract using Python
        const document = await extractWithPython(sourceKey, tempFile);
        results.push({ sourceKey, success: true, document });

        // Cleanup temp file
        await rm(tempFile, { force: true });

        if (verbose) {
          console.log(`  Extracted: ${basename(sourceKey)} (${document.wordCount} words)`);
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ sourceKey, success: false, error });

        if (verbose) {
          console.error(`  Failed: ${basename(sourceKey)}: ${error}`);
        }
      }
    }
  };

  const workerPromises = Array(Math.min(workers, keys.length))
    .fill(null)
    .map(() => processFile());

  await Promise.all(workerPromises);
  return results;
}

function generateId(key: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(key);
  return hasher.digest("hex").slice(0, 16);
}

async function loadProgress(
  storage: ExtractConfig["storage"],
  outputPrefix: string
): Promise<ExtractionProgress> {
  try {
    const content = await storage.read(`${outputPrefix}/${PROGRESS_FILE}`);
    if (content) {
      return JSON.parse(new TextDecoder().decode(content));
    }
  } catch {
    // Ignore errors, return fresh progress
  }

  return {
    totalFiles: 0,
    processedFiles: 0,
    successCount: 0,
    errorCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function saveProgress(
  storage: ExtractConfig["storage"],
  outputPrefix: string,
  progress: ExtractionProgress
): Promise<void> {
  await storage.write(
    `${outputPrefix}/${PROGRESS_FILE}`,
    JSON.stringify(progress, null, 2)
  );
}

async function appendError(
  storage: ExtractConfig["storage"],
  outputPrefix: string,
  error: string,
  sourceKey: string
): Promise<void> {
  const errorsKey = `${outputPrefix}/${ERRORS_FILE}`;
  const line = JSON.stringify({ sourceKey, error, timestamp: new Date().toISOString() }) + "\n";

  // Read existing errors and append
  const existing = await storage.read(errorsKey);
  const existingText = existing ? new TextDecoder().decode(existing) : "";
  await storage.write(errorsKey, existingText + line);
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
