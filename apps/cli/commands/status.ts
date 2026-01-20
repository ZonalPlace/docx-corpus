import { loadConfig, VERSION } from "@docx-corpus/scraper";
import { createDb, header, section, keyValue, blank } from "@docx-corpus/shared";

export async function runStatus(_args: string[]) {
  header("docx-corpus", VERSION);

  const config = loadConfig();
  const db = await createDb(config.database.url);

  try {
    // Scraping stats
    const scrapingStats = await db.getStats();
    section("Scraping");
    let total = 0;
    for (const { status, count } of scrapingStats) {
      keyValue(status, count);
      total += count;
    }
    keyValue("total", total);

    // Extraction stats
    const extractionStats = await db.getExtractionStats();
    blank();
    section("Extraction");
    keyValue("extracted", extractionStats.extracted);
    keyValue("pending", extractionStats.pending);
    keyValue("errors", extractionStats.errors);

    // Embedding stats
    const embeddingStats = await db.getEmbeddingStats();
    blank();
    section("Embedding");
    keyValue("embedded", embeddingStats.embedded);
    keyValue("pending", embeddingStats.pending);

    // Classification stats
    const classificationStats = await db.getClassificationStats();
    blank();
    section("Classification");
    keyValue("classified", classificationStats.classified);
    keyValue("pending", classificationStats.pending);
    keyValue("clusters", classificationStats.clusters);
  } finally {
    await db.close();
  }
}
