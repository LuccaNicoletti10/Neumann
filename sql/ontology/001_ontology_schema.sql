
CREATE SCHEMA IF NOT EXISTS ontology;

CREATE TABLE IF NOT EXISTS ontology.versions (
    id UUID PRIMARY KEY,
    client TEXT NOT NULL,
    semantic_version TEXT NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL,
    parent_version_id UUID NULL REFERENCES ontology.versions(id),
    definition_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by TEXT NOT NULL,
    published_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS ontology.object_type_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    object_type_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    base_type_id TEXT NULL,
    key_property_id TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    definition_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology.property_type_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    property_type_id TEXT NOT NULL,
    object_type_id TEXT NOT NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    required BOOLEAN NOT NULL,
    nullable BOOLEAN NOT NULL,
    cardinality TEXT NOT NULL,
    default_value JSONB NULL,
    definition_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology.property_components (
    id UUID PRIMARY KEY,
    property_type_definition_id UUID NOT NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    position INT NOT NULL,
    required BOOLEAN NOT NULL,
    default_value JSONB NULL
);

CREATE TABLE IF NOT EXISTS ontology.parser_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    parser_definition_id TEXT NOT NULL,
    property_type_id TEXT NOT NULL,
    parser_type TEXT NOT NULL,
    priority INT NOT NULL,
    matcher_json JSONB NOT NULL,
    transform_name TEXT NOT NULL,
    args_json JSONB NOT NULL,
    continue_on_invalid BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ontology.parser_subdefinitions (
    id UUID PRIMARY KEY,
    parser_definition_id UUID NOT NULL,
    position INT NOT NULL,
    source_pattern TEXT NOT NULL,
    capture_group TEXT NOT NULL,
    target_component TEXT NOT NULL,
    transform_name TEXT NULL,
    required BOOLEAN NOT NULL,
    default_value JSONB NULL
);

CREATE TABLE IF NOT EXISTS ontology.validator_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    validator_definition_id TEXT NOT NULL,
    property_type_id TEXT NOT NULL,
    validator_type TEXT NOT NULL,
    args_json JSONB NOT NULL,
    error_code TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL,
    position INT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology.parse_events (
    id UUID PRIMARY KEY,
    client TEXT NOT NULL,
    run_id TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    object_type_id TEXT NOT NULL,
    property_type_id TEXT NOT NULL,
    ontology_version_id TEXT NOT NULL,
    parser_definition_id TEXT NULL,
    raw_value_hash TEXT NOT NULL,
    canonical_value_json JSONB NULL,
    status TEXT NOT NULL,
    errors_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE SCHEMA IF NOT EXISTS raw_meta;

CREATE TABLE IF NOT EXISTS raw_meta.quarantine (
    id UUID PRIMARY KEY,
    client TEXT NOT NULL,
    run_id TEXT NOT NULL,
    dataset TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    raw_row_json JSONB NOT NULL,
    error_code TEXT NOT NULL,
    error_path TEXT NULL,
    error_message TEXT NOT NULL,
    ontology_version_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ NULL,
    resolution_comment TEXT NULL
);
