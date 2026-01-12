CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  crawl_id TEXT NOT NULL,
  original_filename TEXT,
  file_size_bytes INTEGER,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  is_valid_docx BOOLEAN,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  downloaded_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'downloading', 'validating', 'uploaded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_crawl ON documents(crawl_id);
CREATE INDEX IF NOT EXISTS idx_url ON documents(source_url);
