-- Migration 0009 — ObjectSet SQL planner indexes (GIN properties + link locality)
-- GIN jsonb_path_ops enables EQUALS fast path via properties @>
-- Link indexes cover SEARCH_AROUND forward and reverse.

CREATE INDEX IF NOT EXISTS platform_objects_props_gin
  ON platform_objects USING GIN (properties jsonb_path_ops)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS platform_links_src_idx
  ON platform_links (ontology_id, link_type_id, source_object_type_id, source_primary_key)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS platform_links_tgt_idx
  ON platform_links (ontology_id, link_type_id, target_object_type_id, target_primary_key)
  WHERE deleted = FALSE;
