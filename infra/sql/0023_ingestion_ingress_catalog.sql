-- 0023_ingestion_ingress_catalog.sql
-- Durable connector/mapping catalog + webhook inbox/nonce (ADR-0017).
-- Does not edit 0001–0022.

CREATE TABLE IF NOT EXISTS connector_registrations (
  connector_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('csv', 'http', 'webhook')),
  enabled BOOLEAN NOT NULL,
  config JSONB NOT NULL,
  secret_ref TEXT,
  service_principal TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT connector_registrations_config_no_secret CHECK (NOT (config ? 'secret')),
  CONSTRAINT connector_registrations_config_no_password CHECK (NOT (config ? 'password')),
  CONSTRAINT connector_registrations_config_no_token CHECK (NOT (config ? 'token'))
);

CREATE TABLE IF NOT EXISTS mapping_versions (
  id TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version_id TEXT NOT NULL,
  source_schema_version TEXT,
  dataset_id TEXT NOT NULL,
  object_type_id TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_by TEXT NOT NULL,
  parent_version_id TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  UNIQUE (mapping_id, version_number),
  UNIQUE (mapping_id, content_hash)
);

CREATE INDEX IF NOT EXISTS mapping_versions_latest_idx
  ON mapping_versions (mapping_id, version_number DESC);

CREATE TABLE IF NOT EXISTS ingestion_webhook_inbox (
  connector_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES ingestion_runs (id),
  envelope_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (connector_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS ingestion_webhook_nonces (
  connector_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (connector_id, nonce)
);

CREATE UNIQUE INDEX IF NOT EXISTS ingestion_quarantine_run_event_uid
  ON ingestion_quarantine (run_id, source_event_id);

CREATE INDEX IF NOT EXISTS ingestion_runs_claim_idx
  ON ingestion_runs (created_at)
  WHERE status IN ('pending', 'running');
