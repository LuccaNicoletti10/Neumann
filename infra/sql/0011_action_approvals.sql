-- Migration 0011 — action execution approval payload (additive).

ALTER TABLE platform_action_executions
  ADD COLUMN IF NOT EXISTS approval jsonb NULL;
