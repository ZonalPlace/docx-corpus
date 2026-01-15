export interface ParsedFlags {
  batchSize?: number;
  crawlIds?: string[];
  crawlCount?: number;
  verbose?: boolean;
  force?: boolean;
}

export function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--batch" && args[i + 1]) {
      flags.batchSize = parseInt(args[++i], 10);
    } else if (arg === "--crawl" && args[i + 1]) {
      const value = args[++i];
      // Bare number = count of latest crawls
      if (/^\d+$/.test(value)) {
        flags.crawlCount = parseInt(value, 10);
        flags.crawlIds = undefined; // Clear other field (last wins)
      } else if (value.includes(",")) {
        // Comma-separated list - filter empty segments
        flags.crawlIds = value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        flags.crawlCount = undefined; // Clear other field (last wins)
      } else {
        // Single crawl ID
        flags.crawlIds = [value];
        flags.crawlCount = undefined; // Clear other field (last wins)
      }
    } else if (arg === "--verbose" || arg === "-v") {
      flags.verbose = true;
    } else if (arg === "--force" || arg === "-f") {
      flags.force = true;
    }
  }

  return flags;
}
