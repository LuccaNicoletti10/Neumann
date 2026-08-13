-- Migration 0005 — SQL-mirror write-back queue (outbox worker drain target)
-- The Action UnitOfWork writes the intent to outbox_events. The worker
-- copies it here after commit. Swap this table for an HTTP ERP call later;
-- OutboxHandler signature stays the same.

CREATE TABLE IF NOT EXISTS erp_writeback_queue (
  event_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  principal TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
