-- Migration 0003 — object history + ontology durability scaffolding

CREATE TABLE IF NOT EXISTS platform_object_history (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version_id TEXT,
  object_type_id TEXT NOT NULL,
  primary_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  principal TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('create','update','delete','restore')),
  provenance JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_object_history_obj_idx
  ON platform_object_history (object_id, version);

CREATE TABLE IF NOT EXISTS platform_ontologies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latest_version_id TEXT
);

CREATE TABLE IF NOT EXISTS platform_ontology_versions (
  id TEXT PRIMARY KEY,
  ontology_id TEXT NOT NULL REFERENCES platform_ontologies(id),
  version_number INTEGER NOT NULL,
  parent_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMMITTED',
  snapshot JSONB NOT NULL,
  UNIQUE (ontology_id, version_number)
);
