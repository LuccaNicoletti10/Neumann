-- Migration 0008 — operational outbox: status machine, backoff, lease, writeback executions
-- published_at is ONLY set on DELIVERED. Dead-letter / unhandled never look "published".

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_status_check;
ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_status_check
  CHECK (status IN ('PENDING', 'PROCESSING', 'RETRYING', 'DELIVERED', 'DEAD_LETTER', 'UNHANDLED'));

UPDATE outbox_events
SET status = 'DEAD_LETTER',
    dead_lettered_at = COALESCE(dead_lettered_at, published_at, now()),
    published_at = NULL
WHERE published_at IS NOT NULL
  AND COALESCE(payload->>'__dead_letter', 'false') = 'true'
  AND status <> 'DEAD_LETTER';

UPDATE outbox_events
SET status = 'UNHANDLED',
    published_at = NULL
WHERE published_at IS NOT NULL
  AND COALESCE(payload->>'__unhandled', 'false') = 'true'
  AND status <> 'UNHANDLED';

UPDATE outbox_events
SET status = 'DELIVERED',
    delivered_at = COALESCE(delivered_at, published_at)
WHERE published_at IS NOT NULL
  AND status NOT IN ('DEAD_LETTER', 'UNHANDLED', 'DELIVERED');

UPDATE outbox_events
SET status = 'PENDING',
    next_attempt_at = COALESCE(next_attempt_at, created_at)
WHERE published_at IS NULL
  AND status NOT IN ('PENDING', 'RETRYING', 'PROCESSING', 'DEAD_LETTER', 'UNHANDLED');

CREATE INDEX IF NOT EXISTS outbox_events_claim_idx
  ON outbox_events (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'RETRYING');

CREATE INDEX IF NOT EXISTS outbox_events_lease_idx
  ON outbox_events (lease_until)
  WHERE status = 'PROCESSING';

CREATE TABLE IF NOT EXISTS writeback_executions (
  id TEXT PRIMARY KEY,
  outbox_event_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT,
  external_id TEXT,
  external_operation_id TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  response_hash TEXT,
  response_metadata JSONB,
  idempotency_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS writeback_executions_event_idx
  ON writeback_executions (outbox_event_id, attempt);
