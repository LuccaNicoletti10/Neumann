-- 0024_mapping_immutability.sql
-- Append-only mapping_versions + nonce expiry hygiene (ADR-0018).
-- Does not edit 0001–0023.

CREATE OR REPLACE FUNCTION mapping_versions_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'mapping_versions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS mapping_versions_immutable ON mapping_versions;
CREATE TRIGGER mapping_versions_immutable
  BEFORE UPDATE OR DELETE ON mapping_versions
  FOR EACH ROW
  EXECUTE FUNCTION mapping_versions_deny_mutation();

CREATE INDEX IF NOT EXISTS ingestion_webhook_nonces_expires_at_idx
  ON ingestion_webhook_nonces (expires_at);

ALTER TABLE connector_registrations
  DROP CONSTRAINT IF EXISTS connector_registrations_config_no_authorization;
ALTER TABLE connector_registrations
  ADD CONSTRAINT connector_registrations_config_no_authorization
  CHECK (NOT (config ? 'authorization'));

ALTER TABLE connector_registrations
  DROP CONSTRAINT IF EXISTS connector_registrations_config_no_apikey;
ALTER TABLE connector_registrations
  ADD CONSTRAINT connector_registrations_config_no_apikey
  CHECK (NOT (config ? 'apiKey') AND NOT (config ? 'apikey'));

ALTER TABLE connector_registrations
  DROP CONSTRAINT IF EXISTS connector_registrations_config_no_client_secret;
ALTER TABLE connector_registrations
  ADD CONSTRAINT connector_registrations_config_no_client_secret
  CHECK (NOT (config ? 'clientSecret') AND NOT (config ? 'client_secret'));
