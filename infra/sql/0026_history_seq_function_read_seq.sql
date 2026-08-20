-- Migration 0026 — global history sequence + Function readSeq (ADR-0021)
-- Do not edit 0001–0025. Sequence is the multi-replica asOf watermark.

CREATE SEQUENCE IF NOT EXISTS platform_history_seq;

ALTER TABLE platform_object_history
  ADD COLUMN IF NOT EXISTS seq BIGINT;

UPDATE platform_object_history
SET seq = nextval('platform_history_seq')
WHERE seq IS NULL;

ALTER TABLE platform_object_history
  ALTER COLUMN seq SET DEFAULT nextval('platform_history_seq');

ALTER TABLE platform_object_history
  ALTER COLUMN seq SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_object_history_seq_uidx
  ON platform_object_history (seq);

CREATE INDEX IF NOT EXISTS platform_object_history_asof_seq_idx
  ON platform_object_history (ontology_id, object_type_id, primary_key, seq DESC);

ALTER TABLE function_executions
  ADD COLUMN IF NOT EXISTS read_seq BIGINT;

CREATE INDEX IF NOT EXISTS function_executions_read_seq_idx
  ON function_executions (read_seq)
  WHERE read_seq IS NOT NULL;
