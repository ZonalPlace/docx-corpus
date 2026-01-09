import { Database } from "bun:sqlite";
import { join } from "node:path";

export async function generateManifest(
  localPath: string,
): Promise<{ count: number; path: string } | null> {
  const dbPath = join(localPath, "corpus.db");

  const db = new Database(dbPath, { readonly: true });

  const rows = db
    .query("SELECT id FROM documents WHERE status = 'uploaded' ORDER BY id")
    .all() as { id: string }[];

  db.close();

  if (rows.length === 0) {
    return null;
  }

  const path = join(localPath, "manifest.txt");
  const content = `${rows.map((r) => r.id).join("\n")}\n`;
  await Bun.write(path, content);

  return { count: rows.length, path };
}

// CLI entry point
if (import.meta.main) {
  (async () => {
    const { loadConfig } = await import("./config");
    const config = loadConfig();

    const result = await generateManifest(config.storage.localPath);

    if (!result) {
      console.log("No uploaded documents found.");
      process.exit(0);
    }

    console.log(`Generated ${result.path} with ${result.count} documents`);
  })();
}
