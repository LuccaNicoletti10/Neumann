-- 0020_action_idempotency_scope.sql
--
-- WHY: the old index on (ontology_id, action_api_name, idempotency_key) allowed
-- two principals to collide on the same key and race-overwrite each other's claim.
-- The canonical idempotency scope is (ontology_id, principal, action_api_name,
-- idempotency_key) — a different principal is an independent execution.
--
-- Fail-closed: detects collisions in the existing index before dropping it so the
-- migration itself does not corrupt data.

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  -- Detect rows that would collide under the new narrower scope (same key,
  -- different principals). If any exist the migration cannot proceed safely.
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT ontology_id, action_api_name, idempotency_key
    FROM platform_action_executions
    WHERE idempotency_key IS NOT NULL
    GROUP BY ontology_id, action_api_name, idempotency_key
    HAVING COUNT(DISTINCT principal) > 1
  ) t;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'migration 0020 aborted: % row(s) share the same idempotency key across principals; '
      'resolve conflicts before migrating', duplicate_count;
  END IF;
END;
$$;

-- Drop the old three-column index (without principal).
DROP INDEX IF EXISTS platform_action_idempotency_idx;

-- New four-column unique index that matches the canonical scope.
CREATE UNIQUE INDEX IF NOT EXISTS platform_action_idempotency_scope_idx
  ON platform_action_executions (ontology_id, principal, action_api_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
