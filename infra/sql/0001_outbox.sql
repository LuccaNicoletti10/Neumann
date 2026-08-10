-- Migration 0001 — outbox + principals mínimos (BLOCO 1 / M0)
-- Revisar antes de produção; tenant_id desde o dia 1.

CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'service')),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  ordering_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  principal TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
  ON outbox_events (created_at)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS outbox_events_key_idx
  ON outbox_events (ordering_key, created_at);
