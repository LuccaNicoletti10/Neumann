-- Migration 0012 — pipeline assets + staleness.

CREATE TABLE IF NOT EXISTS pipeline_assets (
  id text PRIMARY KEY,
  dataset_id text NOT NULL,
  pipeline_id text NOT NULL,
  last_materialization_id text NULL
);

CREATE TABLE IF NOT EXISTS pipeline_asset_state (
  dataset_id text PRIMARY KEY,
  stale boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
