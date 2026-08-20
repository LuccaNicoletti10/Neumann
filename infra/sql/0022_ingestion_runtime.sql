-- 0022_ingestion_runtime.sql
-- Durable IngestionRuntime state (ADR-0016). Does not edit 0001–0021.
--
-- WHY these tables are not outbox: ingest identity is (run, sourceEventId) and
-- a mapping pin, not an Action execution. Outbox remains the existing port.

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  principal TEXT NOT NULL,
  pin JSONB NOT NULL,
  cursor TEXT,
  object_name TEXT NOT NULL,
  processed_count INTEGER NOT NULL DEFAULT 0,
  quarantined_count INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ingestion_runs_connector_idx
  ON ingestion_runs (connector_id, status);

CREATE TABLE IF NOT EXISTS ingestion_envelopes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingestion_runs (id),
  connector_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_schema_version TEXT,
  occurred_at TEXT NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (run_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS ingestion_quarantine (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingestion_runs (id),
  source_event_id TEXT NOT NULL,
  envelope JSONB NOT NULL,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  pin JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
  connector_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (connector_id, object_name)
);
