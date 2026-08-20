-- 0025_function_runtime.sql
-- Durable Function artifacts and executions (ADR-0019).
-- Does not edit 0001–0024.

CREATE TABLE function_artifacts (
    artifact_hash TEXT PRIMARY KEY
      CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
    bytes BYTEA NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0 AND byte_length = octet_length(bytes)),
    created_at TIMESTAMPTZ NOT NULL,
    created_by TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION function_artifacts_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'function_artifacts is append-only';
END;
$$;

DROP TRIGGER IF EXISTS function_artifacts_immutable ON function_artifacts;
CREATE TRIGGER function_artifacts_immutable
  BEFORE UPDATE OR DELETE ON function_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION function_artifacts_deny_mutation();

CREATE TABLE function_executions (
    id TEXT PRIMARY KEY,
    ontology_id TEXT NOT NULL,
    ontology_version_id TEXT NOT NULL,
    function_id TEXT NOT NULL,
    function_version INTEGER NOT NULL CHECK (function_version >= 1),
    artifact_hash TEXT NOT NULL REFERENCES function_artifacts (artifact_hash),
    input_schema_hash TEXT NOT NULL,
    output_schema_hash TEXT NOT NULL,
    principal TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    parameters_hash TEXT NOT NULL,
    object_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    object_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    read_as_of TIMESTAMPTZ NOT NULL,
    policy_generation INTEGER NOT NULL,
    idempotency_key TEXT,
    request_hash TEXT,
    status TEXT NOT NULL CHECK (status IN (
      'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED'
    )),
    result JSONB,
    error JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    log_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT function_executions_output_xor_error CHECK (
      (
        status IN ('PENDING', 'RUNNING')
        AND result IS NULL
        AND error IS NULL
        AND finished_at IS NULL
      )
      OR (
        status = 'SUCCEEDED'
        AND result IS NOT NULL
        AND error IS NULL
        AND finished_at IS NOT NULL
      )
      OR (
        status IN ('FAILED', 'DENIED', 'CANCELLED')
        AND result IS NULL
        AND error IS NOT NULL
        AND finished_at IS NOT NULL
      )
    ),
    CONSTRAINT function_executions_idempotency_hash CHECK (
      (idempotency_key IS NULL AND request_hash IS NULL)
      OR (idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
    )
);

CREATE UNIQUE INDEX function_executions_idempotency_scope
  ON function_executions (ontology_id, principal, function_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX function_executions_claim_idx
  ON function_executions (status, lease_expires_at, created_at);
