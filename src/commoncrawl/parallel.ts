import { AsyncQueue } from "../utils/async-queue";
import {
  type CdxRecord,
  type FileProgress,
  getCdxPaths,
  streamCdxFile,
} from "./cdx-index";

export interface ParallelProgress {
  totalFiles: number;
  completedFiles: number;
  activeFiles: Map<string, FileProgress>;
}

export type ParallelProgressCallback = (progress: ParallelProgress) => void;

export interface ParallelStreamOptions {
  concurrency?: number;
  onProgress?: ParallelProgressCallback;
  cacheDir?: string;
  verbose?: boolean;
}

/**
 * Stream CDX records from multiple files in parallel.
 * Uses a producer-consumer pattern with bounded queue for backpressure.
 */
export async function* streamAllCdxFilesParallel(
  crawlId: string,
  options: ParallelStreamOptions = {},
): AsyncGenerator<CdxRecord> {
  const { concurrency = 10, onProgress, cacheDir, verbose } = options;

  const paths = await getCdxPaths(crawlId);
  const queue = new AsyncQueue<CdxRecord>(1000);
  let pathIndex = 0;
  let completedFiles = 0;
  let activeWorkers = 0;
  let stopped = false;

  // Track progress for each active file
  const activeFiles = new Map<string, FileProgress>();

  const reportProgress = () => {
    onProgress?.({
      totalFiles: paths.length,
      completedFiles,
      activeFiles,
    });
  };

  const workerPromises: Promise<void>[] = [];

  async function worker() {
    while (pathIndex < paths.length && !stopped) {
      const idx = pathIndex++;
      if (idx >= paths.length) break;

      const path = paths[idx];
      const filename = path.split("/").pop() || path;

      // Initialize file progress
      activeFiles.set(filename, {
        filename,
        bytesDownloaded: 0,
        bytesTotal: 0,
        recordsFound: 0,
      });
      reportProgress();

      for await (const record of streamCdxFile(path, {
        cacheDir,
        verbose,
        onFileProgress: (progress) => {
          if (stopped) return;
          activeFiles.set(filename, progress);
          reportProgress();
        },
      })) {
        if (stopped) break;
        await queue.push(record);
      }

      // File completed
      activeFiles.delete(filename);
      completedFiles++;
      if (!stopped) reportProgress();
    }
    if (--activeWorkers === 0) queue.close();
  }

  // Start workers
  for (let i = 0; i < concurrency; i++) {
    activeWorkers++;
    workerPromises.push(worker());
  }

  // Yield from queue
  try {
    while (true) {
      const record = await queue.pop();
      if (record === null) break;
      yield record;
    }
  } finally {
    // Signal workers to stop and wait for cleanup
    stopped = true;
    queue.close();
    await Promise.all(workerPromises);
    activeFiles.clear();
  }
}
