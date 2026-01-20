import { join, dirname } from "node:path";
import type { EmbedConfig, EmbeddedDocument, EmbeddingIndexEntry, EmbeddingModel } from "./types";
import { formatProgress, writeMultiLineProgress } from "@docx-corpus/shared";

const PYTHON_DIR = join(dirname(import.meta.path), "python");
const PYTHON_PATH = join(PYTHON_DIR, ".venv", "bin", "python");
const SCRIPT_PATH = join(PYTHON_DIR, "embed.py");

const INDEX_FILE = "index.jsonl";
const EXTRACTED_INDEX = "index.jsonl";

/**
 * Entry from the extraction index
 */
interface ExtractedIndexEntry {
  id: string;
  extractedAt: string;
  wordCount: number;
  charCount: number;
  tableCount: number;
  imageCount: number;
  error?: string;
}

export async function processEmbeddings(
  config: EmbedConfig,
  verbose: boolean = false
): Promise<void> {
  const { storage, inputPrefix, outputPrefix, model, batchSize } = config;

  // Load already-embedded IDs
  const embeddedIds = await loadEmbeddedIds(storage, outputPrefix);
  if (embeddedIds.size > 0) {
    console.log(`Already embedded: ${embeddedIds.size} documents`);
  }

  // Load extraction index to get document IDs
  const extractedDocs = await loadExtractedIndex(storage, inputPrefix);
  const toEmbed = extractedDocs.filter((d) => !embeddedIds.has(d.id));

  if (toEmbed.length === 0) {
    console.log("No new documents to embed");
    return;
  }

  // Apply batch limit
  const batch = batchSize === Infinity ? toEmbed : toEmbed.slice(0, batchSize);
  console.log(`Found ${toEmbed.length} documents to embed (processing ${batch.length})`);

  // Process in batches for Python
  const pythonBatchSize = 32; // Send 32 docs at a time to Python
  let processed = 0;
  let errorCount = 0;

  // Progress tracking
  const startTime = Date.now();
  let lastThroughputUpdate = startTime;
  let docsAtLastUpdate = 0;
  let currentDocsPerSec = 0;
  let prevLineCount = 0;

  const updateProgress = () => {
    const now = Date.now();
    const elapsed = (now - lastThroughputUpdate) / 1000;
    if (elapsed >= 1) {
      currentDocsPerSec = (processed - docsAtLastUpdate) / elapsed;
      lastThroughputUpdate = now;
      docsAtLastUpdate = processed;
    }

    const lines = formatProgress({
      saved: processed,
      total: batch.length,
      docsPerSec: currentDocsPerSec,
      failed: errorCount > 0 ? errorCount : undefined,
      elapsedMs: now - startTime,
    });

    prevLineCount = writeMultiLineProgress(lines, prevLineCount);
  };

  const progressInterval = !verbose ? setInterval(updateProgress, 100) : null;

  try {
    for (let i = 0; i < batch.length; i += pythonBatchSize) {
      const pythonBatch = batch.slice(i, i + pythonBatchSize);

      // Read text for each doc
      const docsWithText: { id: string; text: string }[] = [];
      for (const doc of pythonBatch) {
        try {
          const textContent = await storage.read(`${inputPrefix}/${doc.id}.txt`);
          if (textContent) {
            const text = new TextDecoder().decode(textContent);
            docsWithText.push({ id: doc.id, text });
          }
        } catch {
          // Skip if text file not found
          errorCount++;
          if (verbose) {
            console.error(`  Skipped: ${doc.id} (text file not found)`);
          }
        }
      }

      if (docsWithText.length === 0) continue;

      try {
        // Call Python with batch
        const embeddings = await embedBatch(docsWithText, model);

        // Save each embedding
        for (const emb of embeddings) {
          const embeddedDoc: EmbeddedDocument = {
            id: emb.id,
            embedding: emb.embedding,
            model,
            dimensions: emb.dimensions,
            embeddedAt: new Date().toISOString(),
          };

          // Write embedding file
          await storage.write(
            `${outputPrefix}/${emb.id}.json`,
            JSON.stringify(embeddedDoc)
          );

          // Append to index
          await appendToIndex(storage, outputPrefix, embeddedDoc);
          processed++;

          if (verbose) {
            console.log(`  Embedded: ${emb.id} (${emb.dimensions} dims)`);
          }
        }
      } catch (err) {
        errorCount += docsWithText.length;
        if (verbose) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`  Batch failed: ${error}`);
        }
      }
    }
  } finally {
    if (progressInterval) {
      clearInterval(progressInterval);
      updateProgress();
      console.log();
    }
  }

  console.log(`Embedded: ${processed} documents, ${errorCount} errors`);
  console.log(`  Output: ${outputPrefix}/{hash}.json`);
  console.log(`  Index: ${outputPrefix}/${INDEX_FILE}`);
}

async function embedBatch(
  docs: { id: string; text: string }[],
  model: EmbeddingModel
): Promise<{ id: string; embedding: number[]; dimensions: number }[]> {
  const proc = Bun.spawn([PYTHON_PATH, SCRIPT_PATH, "--model", model, "--batch"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Pass through VOYAGE_API_KEY if set
    },
  });

  // Write docs to stdin as JSONL
  for (const doc of docs) {
    proc.stdin.write(JSON.stringify(doc) + "\n");
  }
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const errorData = stderr ? JSON.parse(stderr) : { error: "Unknown error" };
    throw new Error(errorData.error || "Python embedding failed");
  }

  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function loadEmbeddedIds(
  storage: EmbedConfig["storage"],
  outputPrefix: string
): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const content = await storage.read(`${outputPrefix}/${INDEX_FILE}`);
    if (content) {
      const text = new TextDecoder().decode(content);
      for (const line of text.split("\n")) {
        if (line.trim()) {
          const entry = JSON.parse(line) as EmbeddingIndexEntry;
          ids.add(entry.id);
        }
      }
    }
  } catch {
    // Index doesn't exist yet
  }
  return ids;
}

async function loadExtractedIndex(
  storage: EmbedConfig["storage"],
  inputPrefix: string
): Promise<ExtractedIndexEntry[]> {
  const docs: ExtractedIndexEntry[] = [];
  try {
    const content = await storage.read(`${inputPrefix}/${EXTRACTED_INDEX}`);
    if (content) {
      const text = new TextDecoder().decode(content);
      for (const line of text.split("\n")) {
        if (line.trim()) {
          const entry = JSON.parse(line) as ExtractedIndexEntry;
          // Skip entries with errors
          if (!entry.error) {
            docs.push(entry);
          }
        }
      }
    }
  } catch {
    // Index doesn't exist
  }
  return docs;
}

async function appendToIndex(
  storage: EmbedConfig["storage"],
  outputPrefix: string,
  doc: EmbeddedDocument
): Promise<void> {
  const indexKey = `${outputPrefix}/${INDEX_FILE}`;
  const entry: EmbeddingIndexEntry = {
    id: doc.id,
    model: doc.model,
    dimensions: doc.dimensions,
    embeddedAt: doc.embeddedAt,
  };

  // Read existing index and append
  const existing = await storage.read(indexKey);
  const existingText = existing ? new TextDecoder().decode(existing) : "";
  await storage.write(indexKey, existingText + JSON.stringify(entry) + "\n");
}
