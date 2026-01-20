import {
  processEmbeddings,
  loadEmbedderConfig,
  hasCloudflareCredentials,
  hasVoyageCredentials,
  type EmbedConfig,
  type EmbeddingModel,
} from "@docx-corpus/embedder";
import { createLocalStorage, createR2Storage } from "@docx-corpus/shared";

interface ParsedFlags {
  model?: EmbeddingModel;
  batchSize?: number;
  workers?: number;
  verbose: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--model":
      case "-m":
        flags.model = next as EmbeddingModel;
        i++;
        break;
      case "--batch":
      case "-b":
        flags.batchSize = parseInt(next || "", 10);
        i++;
        break;
      case "--workers":
      case "-w":
        flags.workers = parseInt(next || "", 10);
        i++;
        break;
      case "--verbose":
      case "-v":
        flags.verbose = true;
        break;
    }
  }

  return flags;
}

const HELP = `
corpus embed - Generate embeddings for extracted documents

Usage
  corpus embed [options]

Storage is auto-selected based on environment:
  - With R2 credentials: reads from r2://extracted/, writes to r2://embeddings/
  - Without R2 credentials: reads from ./corpus/extracted/, writes to ./corpus/embeddings/

Already-embedded files are automatically skipped (tracked in index.jsonl).

Options
  --model, -m <name>      Embedding model (default: minilm)
                            minilm      - all-MiniLM-L6-v2 (fast, 384 dims)
                            bge-m3      - BAAI/bge-m3 (better quality, 1024 dims)
                            voyage-lite - Voyage 3.5 lite (best, requires API key)
  --batch, -b <n>         Limit to n documents (default: all)
  --workers, -w <n>       Number of parallel workers (default: 4)
  --verbose, -v           Show detailed progress
  --help, -h              Show this help

Environment Variables
  STORAGE_PATH            Local storage path (default: ./corpus)
  CLOUDFLARE_ACCOUNT_ID   Cloudflare account ID (enables R2)
  R2_ACCESS_KEY_ID        R2 access key
  R2_SECRET_ACCESS_KEY    R2 secret key
  R2_BUCKET_NAME          R2 bucket (default: docx-corpus)
  EMBED_INPUT_PREFIX      Input prefix (default: extracted)
  EMBED_OUTPUT_PREFIX     Output prefix (default: embeddings)
  EMBED_MODEL             Default model (default: minilm)
  EMBED_WORKERS           Worker count (default: 4)
  VOYAGE_API_KEY          Voyage AI API key (required for voyage-lite)

Examples
  corpus embed                        # Embed all documents with minilm
  corpus embed -m bge-m3              # Use BGE-M3 model
  corpus embed -m voyage-lite         # Use Voyage API (requires VOYAGE_API_KEY)
  corpus embed -b 100 -v              # Limit to 100, verbose output
`;

export async function runEmbed(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  const flags = parseFlags(args);
  const envConfig = loadEmbedderConfig();
  const useCloud = hasCloudflareCredentials(envConfig);
  const model = flags.model ?? envConfig.embed.model;

  // Validate Voyage API key if needed
  if (model === "voyage-lite" && !hasVoyageCredentials(envConfig)) {
    console.error("Error: VOYAGE_API_KEY environment variable required for voyage-lite model");
    process.exit(1);
  }

  // Create storage based on credentials
  const storage = useCloud
    ? createR2Storage({
        accountId: envConfig.cloudflare.accountId,
        accessKeyId: envConfig.cloudflare.r2AccessKeyId,
        secretAccessKey: envConfig.cloudflare.r2SecretAccessKey,
        bucket: envConfig.cloudflare.r2BucketName,
      })
    : createLocalStorage(envConfig.storage.localPath);

  const config: EmbedConfig = {
    storage,
    inputPrefix: envConfig.embed.inputPrefix,
    outputPrefix: envConfig.embed.outputPrefix,
    model,
    batchSize: flags.batchSize ?? Infinity,
    workers: flags.workers ?? envConfig.embed.workers,
  };

  console.log("Document Embedder");
  console.log("=================");
  console.log(
    `Storage: ${useCloud ? `R2 (${envConfig.cloudflare.r2BucketName})` : `local (${envConfig.storage.localPath})`}`
  );
  console.log(`Input:   ${config.inputPrefix}/`);
  console.log(`Output:  ${config.outputPrefix}/`);
  console.log(`Model:   ${config.model}`);
  console.log(`Workers: ${config.workers}`);
  console.log(`Batch:   ${config.batchSize === Infinity ? "all" : config.batchSize}`);
  console.log("");

  try {
    await processEmbeddings(config, flags.verbose);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}
