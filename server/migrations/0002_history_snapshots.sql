CREATE TABLE IF NOT EXISTS history_releases (
 release_id text PRIMARY KEY, tool_id text NOT NULL, raw_version text NOT NULL,
 build text NOT NULL, release_type text NOT NULL, release_track text NOT NULL,
 normalized_sort_key text NOT NULL, payload jsonb NOT NULL,
 UNIQUE(tool_id, raw_version, build, release_type, release_track)
);
CREATE INDEX IF NOT EXISTS history_release_sort ON history_releases(tool_id, normalized_sort_key DESC, release_id);
CREATE TABLE IF NOT EXISTS history_assets (
 asset_id text PRIMARY KEY, release_id text NOT NULL REFERENCES history_releases(release_id),
 platform text NOT NULL, arch text NOT NULL, installer_type text NOT NULL,
 vendor_asset_key text NOT NULL, download_status text NOT NULL DEFAULT 'unknown', payload jsonb NOT NULL,
 UNIQUE(release_id, platform, arch, installer_type, vendor_asset_key)
);
CREATE INDEX IF NOT EXISTS history_asset_target ON history_assets(release_id, platform, arch, download_status);
CREATE TABLE IF NOT EXISTS history_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tool_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS history_report_tool ON history_reports(tool_id, created_at DESC);
CREATE TABLE IF NOT EXISTS history_snapshots (
 dataset_id text NOT NULL, tool_id text NOT NULL, tool_revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), content_hash text NOT NULL,
 descriptor jsonb NOT NULL, records jsonb NOT NULL,
 PRIMARY KEY(dataset_id, tool_id, tool_revision)
);
CREATE TABLE IF NOT EXISTS history_blobs (hash text PRIMARY KEY, body bytea NOT NULL);
CREATE TABLE IF NOT EXISTS history_manifests (
 dataset_id text NOT NULL, manifest_revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), content_hash text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(dataset_id, manifest_revision)
);
CREATE TABLE IF NOT EXISTS history_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tool_id text NOT NULL, rule text NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 detail text NOT NULL, delivered_at timestamptz, attempts integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS history_alert_open ON history_alerts(tool_id,rule) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS release_source_due ON release_sources(next_run_at,status);

ALTER TABLE release_sources ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE release_sources ADD COLUMN IF NOT EXISTS first_attempt_at timestamptz;
ALTER TABLE release_sources ADD COLUMN IF NOT EXISTS coverage_override text;
