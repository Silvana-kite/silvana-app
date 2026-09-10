CREATE TABLE IF NOT EXISTS release_history (
  tool_id text NOT NULL,
  version text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (tool_id, version)
);
CREATE TABLE IF NOT EXISTS release_sources (
  tool_id text PRIMARY KEY,
  revision text NOT NULL DEFAULT '',
  updated_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  failures integer NOT NULL DEFAULT 0,
  error text,
  checkpoint jsonb,
  status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS release_page_cache (
  url text PRIMARY KEY,
  etag text,
  last_modified text,
  body text NOT NULL,
  next_url text,
  checksum text NOT NULL,
  parser_version integer NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar(80) NOT NULL,
  status varchar(16) NOT NULL,
  candidate_count integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
