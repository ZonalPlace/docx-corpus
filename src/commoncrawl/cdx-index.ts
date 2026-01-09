import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, spawn } from "bun";

const CC_DATA_URL = "https://data.commoncrawl.org";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Parse a CDX line and extract the record if it's a valid .docx
 * CDX format: "surt timestamp {json}"
 * Returns null for invalid lines or non-docx records
 */
export function parseCdxLine(line: string): CdxRecord | null {
  if (!line.trim()) return null;

  const jsonStart = line.indexOf("{");
  if (jsonStart === -1) return null;

  try {
    const record = JSON.parse(line.slice(jsonStart)) as CdxRecord;

    // Only return actual .docx files (not redirects)
    if (record.mime === DOCX_MIME && record.status === "200") {
      return record;
    }
    return null;
  } catch {
    return null;
  }
}

export interface CdxRecord {
  url: string;
  mime: string;
  status: string;
  digest: string;
  length: string;
  offset: string;
  filename: string;
}

export interface StreamProgress {
  totalFiles: number;
  currentFile: number;
  currentFileName: string;
}

export type ProgressCallback = (progress: StreamProgress) => void;

/**
 * Get list of CDX index file paths for a crawl
 */
export async function getCdxPaths(crawlId: string): Promise<string[]> {
  const url = `${CC_DATA_URL}/crawl-data/${crawlId}/cc-index.paths.gz`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch CDX paths: ${response.status}`);
  }

  const compressed = new Uint8Array(await response.arrayBuffer());
  const decompressed = gunzipSync(compressed);
  const text = new TextDecoder().decode(decompressed);

  return text.trim().split("\n").filter(Boolean);
}

/**
 * Stream .docx records from a single CDX index file
 * Uses curl + gunzip for proper multi-member gzip handling
 */
export async function* streamCdxFile(
  cdxPath: string,
  options?: { cacheDir?: string; verbose?: boolean },
): AsyncGenerator<CdxRecord> {
  const filename = cdxPath.split("/").pop() || cdxPath;
  const cacheDir = options?.cacheDir;
  const verbose = options?.verbose;
  const cacheFile = cacheDir ? `${cacheDir}/${filename}.txt` : null;

  // Check cache first
  if (cacheFile && existsSync(cacheFile)) {
    const lines = readFileSync(cacheFile, "utf-8").split("\n");
    for (const line of lines) {
      if (line.trim()) {
        yield JSON.parse(line) as CdxRecord;
      }
    }
    return;
  }

  const url = `${CC_DATA_URL}/${cdxPath}`;
  const records: CdxRecord[] = [];

  if (verbose) {
    console.log(`  [verbose] Fetching: ${url}`);
  }

  // Use curl + gunzip to properly handle multi-member gzip and stream
  const proc = spawn({
    cmd: ["bash", "-c", `curl -sS "${url}" | gunzip | grep "${DOCX_MIME}"`],
    stdout: "pipe",
    stderr: "pipe",
  });

  // Log stderr in verbose mode
  if (verbose) {
    (async () => {
      const stderrReader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.trim()) {
          console.error(`  [verbose] stderr: ${text.trim()}`);
        }
      }
    })();
  }

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullyConsumed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const record = parseCdxLine(line);
        if (record) {
          if (cacheFile) records.push(record);
          yield record;
        }
      }
    }

    // Process any remaining buffer
    const lastRecord = parseCdxLine(buffer);
    if (lastRecord) {
      if (cacheFile) records.push(lastRecord);
      yield lastRecord;
    }

    fullyConsumed = true;
  } finally {
    // Kill subprocess if generator abandoned early
    proc.kill();
    await proc.exited;

    // Only cache if we fully consumed the file (not abandoned mid-stream)
    if (fullyConsumed && cacheFile && cacheDir && records.length > 0) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(
        cacheFile,
        records.map((r) => JSON.stringify(r)).join("\n"),
      );
    }
  }
}

/**
 * Stream .docx records from all CDX files in a crawl
 */
export async function* streamAllCdxFiles(
  crawlId: string,
  options: {
    limit?: number;
    onProgress?: ProgressCallback;
    cacheDir?: string;
    verbose?: boolean;
  } = {},
): AsyncGenerator<CdxRecord> {
  const { limit = Infinity, onProgress, cacheDir, verbose } = options;

  if (verbose) {
    console.log(`  [verbose] Fetching CDX paths for ${crawlId}...`);
  }

  const paths = await getCdxPaths(crawlId);

  if (verbose) {
    console.log(`  [verbose] Found ${paths.length} CDX index files`);
  }

  let yielded = 0;
  let filesProcessed = 0;

  for (const path of paths) {
    if (yielded >= limit) break;

    filesProcessed++;
    const filename = path.split("/").pop() || path;

    onProgress?.({
      totalFiles: paths.length,
      currentFile: filesProcessed,
      currentFileName: filename,
    });

    for await (const record of streamCdxFile(path, { cacheDir, verbose })) {
      if (yielded >= limit) break;

      yield record;
      yielded++;
    }
  }
}
