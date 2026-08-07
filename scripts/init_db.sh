#!/bin/bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE SCHEMA IF NOT EXISTS raw_meta;
  CREATE SCHEMA IF NOT EXISTS ontology;
  CREATE SCHEMA IF NOT EXISTS decisions;
  CREATE SCHEMA IF NOT EXISTS audit;
EOSQL
