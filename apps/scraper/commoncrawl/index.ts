const COLLINFO_URL = "https://index.commoncrawl.org/collinfo.json";

interface CrawlInfo {
  id: string;
  name: string;
}

export async function getLatestCrawlId(): Promise<string> {
  const res = await fetch(COLLINFO_URL);
  const data = (await res.json()) as CrawlInfo[];
  return data[0].id;
}
