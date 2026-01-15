import { parseFlags } from "./cli";
import { getCrawlIds } from "./commoncrawl/index";
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

Options
  --batch <n>     Limit to n documents per crawl (default: all)
  --crawl <spec>  Crawl(s) to process (default: latest)
                    <n>         Latest n crawls (e.g., --crawl 3)
                    <id>        Single crawl ID
                    <id>,<id>   Comma-separated list
  --force         Re-process URLs already in database
  --verbose       Show detailed logs for debugging

Environment Variables
  CRAWL_ID             Common Crawl index ID (e.g., CC-MAIN-2025-51)
  WARC_CONCURRENCY     Parallel WARC file downloads (default: 50)
  WARC_RATE_LIMIT_RPS  WARC requests per second (default: 50)

Examples
  bun run scrape --crawl 3 --batch 100          # Latest 3 crawls, 100 docs each
  bun run scrape --crawl CC-MAIN-2025-51        # Single crawl
  bun run scrape --crawl CC-MAIN-2025-51,CC-MAIN-2025-48
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

  // Resolve crawl IDs from flags
  let crawlIds: string[] | undefined;
  if (flags.crawlCount !== undefined) {
    if (flags.crawlCount < 1) {
      console.error("Error: --crawl count must be at least 1");
      process.exit(1);
    }
    crawlIds = await getCrawlIds(flags.crawlCount);
    if (crawlIds.length === 0) {
      console.error("Error: No crawls available");
      process.exit(1);
    }
    if (crawlIds.length < flags.crawlCount) {
      console.warn(`Warning: Only ${crawlIds.length} crawls available (requested ${flags.crawlCount})`);
    }
  } else if (flags.crawlIds) {
    if (flags.crawlIds.length === 0) {
      console.error("Error: --crawl requires at least one valid crawl ID");
      process.exit(1);
    }
    crawlIds = flags.crawlIds;
  }

  switch (command) {
    case "scrape":
      await scrape(config, flags.batchSize ?? Infinity, flags.verbose, flags.force, crawlIds);
      process.exit(0); // Force exit to clean up any lingering async operations
      break;
    case "status":
      await status(config);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

async function status(config: ReturnType<typeof loadConfig>) {
  header();

  const db = await createDb(config.database.url);

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

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
