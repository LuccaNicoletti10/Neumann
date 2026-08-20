-- Migration 0018 — durable Action execution envelope (additive, nullable).
-- WHY: pause/resume must pin ontology version + ActionType hash + CAS versions.
-- Pre-0018 rows remain readable; resume without pins fails closed (no "latest").

ALTER TABLE platform_action_executions
  ADD COLUMN IF NOT EXISTS ontology_version_id TEXT,
  ADD COLUMN IF NOT EXISTS action_type_hash TEXT,
  ADD COLUMN IF NOT EXISTS expected_object_versions JSONB,
  ADD COLUMN IF NOT EXISTS policy_generation INTEGER;
