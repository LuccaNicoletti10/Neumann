-- Migration 0007 — link versioning + live-graph semantics
-- WORLD NOW = links with deleted=false AND both endpoints live.
-- WORLD HISTORY keeps the row (soft-delete unlink; endpoint delete does not cascade).

ALTER TABLE platform_links
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS provenance JSONB,
  ADD COLUMN IF NOT EXISTS principal TEXT;

CREATE INDEX IF NOT EXISTS platform_links_live_from_idx
  ON platform_links (ontology_id, source_object_type_id, source_primary_key, link_type_id)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS platform_links_live_to_idx
  ON platform_links (ontology_id, target_object_type_id, target_primary_key, link_type_id)
  WHERE deleted = FALSE;
