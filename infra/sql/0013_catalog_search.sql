-- Migration 0013 — catalog search indexes (URN is computed, not stored).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION pg_trgm;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_trgm skipped (need superuser)';
  WHEN undefined_file THEN
    RAISE NOTICE 'pg_trgm extension files not available';
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS platform_objects_pk_trgm
    ON platform_objects USING gin (primary_key gin_trgm_ops);
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'platform_objects_pk_trgm skipped (pg_trgm unavailable)';
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS platform_objects_props_fts
  ON platform_objects USING gin (to_tsvector('simple', properties::text));
