import { join, dirname } from "node:path";
import type { EmbedConfig, EmbeddingModel } from "./types";
import { formatProgress, writeMultiLineProgress, type DocumentRecord } from "@docx-corpus/shared";

const PYTHON_DIR = join(dirname(import.meta.path), "python");
const PYTHON_PATH = join(PYTHON_DIR, ".venv", "bin", "python");
const SCRIPT_PATH = join(PYTHON_DIR, "embed.py");

export async function processEmbeddings(
  config: EmbedConfig,
  verbose: boolean = false
): Promise<void> {
  const { db, storage, inputPrefix, model, batchSize } = config;

  // Get embedding stats from database
  const stats = await db.getEmbeddingStats();
  if (stats.embedded > 0) {
    console.log(`Already embedded: ${stats.embedded} documents`);
  }

  // Get unembedded documents from database
  console.log(`Querying database for unembedded documents...`);
  const documents = await db.getUnembeddedDocuments(batchSize);

  if (documents.length === 0) {
    console.log("No new documents to embed");
    return;
  }

  console.log(`Found ${documents.length} documents to embed`);

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
      total: documents.length,
      docsPerSec: currentDocsPerSec,
      failed: errorCount > 0 ? errorCount : undefined,
      elapsedMs: now - startTime,
    });

    prevLineCount = writeMultiLineProgress(lines, prevLineCount);
  };

  const progressInterval = !verbose ? setInterval(updateProgress, 100) : null;

  try {
    for (let i = 0; i < documents.length; i += pythonBatchSize) {
      const batch = documents.slice(i, i + pythonBatchSize);

      // Read text for each doc from storage
      const docsWithText: { id: string; text: string }[] = [];
      for (const doc of batch) {
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

        // Save each embedding to database
        for (const emb of embeddings) {
          await db.updateEmbedding({
            id: emb.id,
            embedding: emb.embedding,
            embedding_model: model,
            embedded_at: new Date().toISOString(),
          });

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
