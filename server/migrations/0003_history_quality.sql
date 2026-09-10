-- Unknown lifecycle metadata must not imply that a release is still supported.
UPDATE history_releases SET payload=jsonb_set(payload,'{eol}','null'::jsonb)
 WHERE NOT (payload ? 'eolDate') AND payload->'eol'='false'::jsonb;
ALTER TABLE history_assets ADD COLUMN IF NOT EXISTS first_missing_at timestamptz;
