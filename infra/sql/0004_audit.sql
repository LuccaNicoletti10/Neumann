-- Migration 0004 — durable hash-chained audit log (US20150188715)
-- Append MUST lock the chain so concurrent writers cannot fork previousSummaryHash.

CREATE TABLE IF NOT EXISTS platform_audit_entries (
  id TEXT PRIMARY KEY,
  sequence_number BIGSERIAL NOT NULL UNIQUE,
  message_type TEXT NOT NULL CHECK (
    message_type IN ('GENESIS', 'EVENT', 'COMMIT', 'REDACTED')
  ),
  event_data TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  salt TEXT,
  log_hash TEXT NOT NULL,
  summary_hash TEXT NOT NULL,
  previous_summary_hash TEXT,
  principal TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trace_id TEXT,
  ontology_id TEXT,
  action_execution_id TEXT
);

CREATE INDEX IF NOT EXISTS platform_audit_entries_seq_idx
  ON platform_audit_entries (sequence_number);

CREATE INDEX IF NOT EXISTS platform_audit_entries_ontology_idx
  ON platform_audit_entries (ontology_id, sequence_number)
  WHERE ontology_id IS NOT NULL;
