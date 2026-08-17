-- Migration 0010 — durable policy nodes, grants, and generation clock.

CREATE TABLE IF NOT EXISTS policy_nodes (
  id text PRIMARY KEY,
  resource_id text UNIQUE NOT NULL,
  policy text NULL,
  parent_id text NULL REFERENCES policy_nodes(id),
  epid text NULL
);

CREATE INDEX IF NOT EXISTS policy_nodes_policy_idx ON policy_nodes(policy);

CREATE TABLE IF NOT EXISTS policy_grants (
  principal_id text NOT NULL,
  policy text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, policy)
);

CREATE TABLE IF NOT EXISTS policy_epid_tuples (
  policy text NOT NULL,
  parent_id text NOT NULL,
  epid text NOT NULL UNIQUE,
  PRIMARY KEY (policy, parent_id)
);

CREATE INDEX IF NOT EXISTS policy_epid_tuples_policy_idx ON policy_epid_tuples(policy);

CREATE TABLE IF NOT EXISTS policy_meta (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  generation bigint NOT NULL DEFAULT 0
);

INSERT INTO policy_meta (id, generation) VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;
