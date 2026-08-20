-- Migration 0016 — namespaced policy resource IDs + catalog on the same generation.
-- WHY: overlay compilation needs a durable catalog; unscoped object:foo collided across ontologies.
-- Legacy overlay-scheme resource_ids without '/' map to ontology '_'. Native EPID ids (no scheme) unchanged.

ALTER TABLE policy_meta
  ADD COLUMN IF NOT EXISTS catalog jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE policy_nodes
SET resource_id = 'object:_/' || substring(resource_id from 8)
WHERE resource_id LIKE 'object:%'
  AND resource_id NOT LIKE 'object:%/%';

UPDATE policy_nodes
SET resource_id = 'action:_/' || substring(resource_id from 8)
WHERE resource_id LIKE 'action:%'
  AND resource_id NOT LIKE 'action-execution:%'
  AND resource_id NOT LIKE 'action:%/%';

UPDATE policy_nodes
SET resource_id = 'link:_/' || substring(resource_id from 6)
WHERE resource_id LIKE 'link:%'
  AND resource_id NOT LIKE 'link:%/%';
