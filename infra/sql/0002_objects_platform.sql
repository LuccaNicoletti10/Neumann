-- Migration 0002 — generic object / link / action / operational event stores
-- Domain-neutral platform tables (no Product/Machine/PlanLine columns).

CREATE TABLE IF NOT EXISTS platform_objects (
  id TEXT PRIMARY KEY,
  ontology_id TEXT NOT NULL,
  ontology_version_id TEXT,
  object_type_id TEXT NOT NULL,
  primary_key TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  provenance JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ontology_id, object_type_id, primary_key)
);

CREATE INDEX IF NOT EXISTS platform_objects_type_idx
  ON platform_objects (ontology_id, object_type_id)
  WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS platform_links (
  id TEXT PRIMARY KEY,
  ontology_id TEXT NOT NULL,
  link_type_id TEXT NOT NULL,
  source_object_type_id TEXT NOT NULL,
  source_primary_key TEXT NOT NULL,
  target_object_type_id TEXT NOT NULL,
  target_primary_key TEXT NOT NULL,
  cardinality TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (
    ontology_id,
    link_type_id,
    source_object_type_id,
    source_primary_key,
    target_object_type_id,
    target_primary_key
  )
);

CREATE INDEX IF NOT EXISTS platform_links_from_idx
  ON platform_links (ontology_id, source_object_type_id, source_primary_key, link_type_id);

CREATE INDEX IF NOT EXISTS platform_links_to_idx
  ON platform_links (ontology_id, target_object_type_id, target_primary_key, link_type_id);

CREATE TABLE IF NOT EXISTS platform_action_executions (
  id TEXT PRIMARY KEY,
  ontology_id TEXT NOT NULL,
  action_type_id TEXT NOT NULL,
  action_api_name TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  principal TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  result JSONB,
  error TEXT,
  audit_entry_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_action_idempotency_idx
  ON platform_action_executions (ontology_id, action_api_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_operational_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ontology_id TEXT,
  principal TEXT,
  object_id TEXT,
  object_type_id TEXT,
  primary_key TEXT,
  link_id TEXT,
  link_type_id TEXT,
  action_type_id TEXT,
  action_execution_id TEXT,
  payload JSONB
);

CREATE INDEX IF NOT EXISTS platform_ops_events_ontology_idx
  ON platform_operational_events (ontology_id, at DESC);
