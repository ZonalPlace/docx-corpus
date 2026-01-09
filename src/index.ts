import { listCrawls } from "./commoncrawl/index";
import { loadConfig } from "./config";
import { scrape } from "./scraper";
import { createDb } from "./storage/db";
import { blank, header, keyValue, section, VERSION } from "./ui";

const HELP = `
docx-corpus v${VERSION}

Usage
  docx-corpus <command> [options]

Commands
  scrape    Download .docx files from Common Crawl
  status    Show corpus statistics
  crawls    List available Common Crawl indexes

Options
  --limit <n>      Maximum documents to download (default: 100)
  --crawl <id>     Common Crawl index ID (default: latest)
  --keep-index     Cache CDX index files locally for faster reruns
  --verbose        Show detailed logs for debugging

Environment Variables
  CDX_CONCURRENCY   Parallel CDX index downloads (default: 1)
  WARC_CONCURRENCY  Parallel WARC file downloads (default: 10)
  RATE_LIMIT_RPS    Max requests per second (default: 10)

Examples
  bun run scrape --limit 500
  bun run scrape --crawl CC-MAIN-2024-51
  bun run status
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const flags = parseFlags(args.slice(1));
  const config = loadConfig();

  if (flags.crawl) {
    config.crawl.id = flags.crawl;
  }

  switch (command) {
    case "scrape":
      await scrape(config, flags.limit || 100, flags.keepIndex, flags.verbose);
      break;
    case "status":
      await status(config);
      break;
    case "crawls":
      await showCrawls();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

async function status(config: ReturnType<typeof loadConfig>) {
  header();

  const db = await createDb(config.storage.localPath);
  await db.init();

  const stats = await db.getStats();

  section("Corpus Status");
  blank();

  let total = 0;
  for (const { status, count } of stats) {
    keyValue(status, count);
    total += count;
  }

  blank();
  keyValue("Total", total);
}

async function showCrawls() {
  header();

  section("Fetching available crawls...");
  const crawls = await listCrawls();

  blank();
  section("Available Common Crawl indexes");
  blank();

  for (const crawl of crawls.slice(0, 20)) {
    console.log(`  ${crawl}`);
  }

  if (crawls.length > 20) {
    blank();
    console.log(`  ... and ${crawls.length - 20} more`);
  }
}

function parseFlags(args: string[]): {
  limit?: number;
  crawl?: string;
  keepIndex?: boolean;
  verbose?: boolean;
} {
  const flags: {
    limit?: number;
    crawl?: string;
    keepIndex?: boolean;
    verbose?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      flags.limit = parseInt(args[++i], 10);
    } else if (arg === "--crawl" && args[i + 1]) {
      flags.crawl = args[++i];
    } else if (arg === "--keep-index") {
      flags.keepIndex = true;
    } else if (arg === "--verbose" || arg === "-v") {
      flags.verbose = true;
    }
  }

  return flags;
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
