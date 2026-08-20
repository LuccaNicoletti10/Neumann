-- Migration 0019 — request_hash and hash_version on action executions.
-- WHY: same idempotencyKey + different hash = IDEMPOTENCY_CONFLICT (zero writes).
-- Pre-0019 rows have NULL request_hash; a replay of those rows without hash
-- is treated as a plain idempotency replay (no hash comparison possible).

ALTER TABLE platform_action_executions
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS hash_version INTEGER;
