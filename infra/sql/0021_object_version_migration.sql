-- 0021_object_version_migration.sql
-- Declared object migration between OntologyVersions (ADR-0015).
--
-- WHY two columns instead of reading ontology_version_id twice: the trail must
-- state that a migration happened and between which versions. A plain update
-- leaves both NULL, so "migrated" is not inferred from adjacent rows.

ALTER TABLE platform_object_history
  ADD COLUMN IF NOT EXISTS from_ontology_version_id TEXT;

ALTER TABLE platform_object_history
  ADD COLUMN IF NOT EXISTS to_ontology_version_id TEXT;

-- Migrated rows only. Partial index keeps plain history writes out of it.
CREATE INDEX IF NOT EXISTS platform_object_history_migration_idx
  ON platform_object_history (ontology_id, object_type_id, primary_key)
  WHERE to_ontology_version_id IS NOT NULL;
