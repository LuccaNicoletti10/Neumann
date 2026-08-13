-- Passo 21 — entity resolution audit + canonical + fingerprints
-- US20250165857A1 / US 12,393,406 / US20250348288A1 / US 8,788,405 / US 8,818,892

CREATE TABLE IF NOT EXISTS er_match_audit (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  object_type_id TEXT NOT NULL,
  block_key TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  review JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS er_match_audit_run_idx ON er_match_audit (run_id, created_at);
CREATE INDEX IF NOT EXISTS er_match_audit_decision_idx ON er_match_audit (decision);

CREATE TABLE IF NOT EXISTS er_canonical_entities (
  id TEXT PRIMARY KEY,
  object_type_id TEXT NOT NULL,
  member_ids JSONB NOT NULL,
  display_name TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS er_canonical_entities_type_idx ON er_canonical_entities (object_type_id);

CREATE TABLE IF NOT EXISTS er_source_canonical_links (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'unmerged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmerged_at TIMESTAMPTZ,
  unmerge_reason TEXT,
  principal TEXT
);

CREATE INDEX IF NOT EXISTS er_source_canonical_links_record_idx
  ON er_source_canonical_links (record_id, status);
CREATE INDEX IF NOT EXISTS er_source_canonical_links_canon_idx
  ON er_source_canonical_links (canonical_id, status);

CREATE TABLE IF NOT EXISTS er_merge_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('merge', 'unmerge')),
  canonical_id TEXT NOT NULL,
  record_ids JSONB NOT NULL,
  reason TEXT,
  principal TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS er_merge_events_canon_idx ON er_merge_events (canonical_id, created_at);

CREATE TABLE IF NOT EXISTS er_fingerprints (
  record_id TEXT NOT NULL,
  object_type_id TEXT NOT NULL,
  hash BIGINT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (record_id, hash, position)
);

CREATE INDEX IF NOT EXISTS er_fingerprints_hash_idx ON er_fingerprints (hash);
