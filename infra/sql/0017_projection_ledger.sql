-- Migration 0017 — projection ledger (not ActionExecution).
-- WHY: sourceEventId uniqueness is per source+ontology; replay must not duplicate
-- object/link/history/event/outbox effects. Same key + different payload conflicts.

CREATE TABLE IF NOT EXISTS projection_ledger (
  source TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  operation TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ontology_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS projection_ledger_ontology_idx
  ON projection_ledger (ontology_id, created_at DESC);
