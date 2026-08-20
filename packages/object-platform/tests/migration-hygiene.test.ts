/**
 * object-platform — tests/migration-hygiene.test.ts
 *
 * Operational recovery is fail-closed on checksum mismatch. Deleting a
 * schema_migrations row is not a supported procedure.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { findInfraSqlDir, listPlatformMigrationFiles } from '../src/core/pg-sql.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const FORBIDDEN = /DELETE\s+FROM\s+schema_migrations|TRUNCATE\s+(TABLE\s+)?schema_migrations/i;

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage' || name === '_archive') {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, acc);
    else if (/\.(ts|mjs|js|md|mdc)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('migration hygiene', () => {
  it('the numbered tail is 0026 and 0001–0025 remain intact', () => {
    const files = listPlatformMigrationFiles();
    expect(files.at(-1)).toBe('0026_history_seq_function_read_seq.sql');
    expect(files).toContain('0025_function_runtime.sql');
    expect(files.filter((f) => f.startsWith('0026_'))).toEqual(['0026_history_seq_function_read_seq.sql']);
  });

  it('operational sources never instruct deleting schema_migrations', () => {
    const roots = [
      join(repoRoot, 'scripts'),
      join(repoRoot, 'packages/object-platform/src'),
      join(repoRoot, 'docs/architecture'),
      join(repoRoot, '.cursor/rules'),
    ];
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walkFiles(root)) {
        const body = readFileSync(file, 'utf8');
        if (FORBIDDEN.test(body)) hits.push(file.slice(repoRoot.length + 1));
      }
    }
    expect(hits).toEqual([]);
  });

  it('0021 remains append-only object migration columns, not a rewritten historical row', () => {
    const infra = findInfraSqlDir();
    const body = readFileSync(join(infra, '0021_object_version_migration.sql'), 'utf8');
    expect(body).toMatch(/from_ontology_version_id/);
    expect(body).toMatch(/to_ontology_version_id/);
    expect(body).not.toMatch(FORBIDDEN);
  });

  it('0022 is append-only ingestion runtime state', () => {
    const infra = findInfraSqlDir();
    const body = readFileSync(join(infra, '0022_ingestion_runtime.sql'), 'utf8');
    expect(body).toMatch(/ingestion_runs/);
    expect(body).toMatch(/ingestion_quarantine/);
    expect(body).toMatch(/ingestion_checkpoints/);
    expect(body).not.toMatch(FORBIDDEN);
  });

  it('0023 is append-only ingress catalog and nonce protection', () => {
    const infra = findInfraSqlDir();
    const body = readFileSync(join(infra, '0023_ingestion_ingress_catalog.sql'), 'utf8');
    expect(body).toMatch(/connector_registrations/);
    expect(body).toMatch(/mapping_versions/);
    expect(body).toMatch(/ingestion_webhook_nonces/);
    expect(body).not.toMatch(FORBIDDEN);
  });

  it('0024 is append-only mapping immutability and nonce expiry hygiene', () => {
    const infra = findInfraSqlDir();
    const body = readFileSync(join(infra, '0024_mapping_immutability.sql'), 'utf8');
    expect(body).toMatch(/mapping_versions_immutable/);
    expect(body).toMatch(/ingestion_webhook_nonces_expires_at_idx/);
    expect(body).not.toMatch(FORBIDDEN);
  });

  it('0025 is append-only function artifacts and executions', () => {
    const infra = findInfraSqlDir();
    const body = readFileSync(join(infra, '0025_function_runtime.sql'), 'utf8');
    expect(body).toMatch(/function_artifacts/);
    expect(body).toMatch(/function_executions/);
    expect(body).toMatch(/function_artifacts_immutable/);
    expect(body).not.toMatch(FORBIDDEN);
  });

  it('0026 is append-only history seq and function read_seq', () => {
    const infra = findInfraSqlDir();
    const body = readFileSync(join(infra, '0026_history_seq_function_read_seq.sql'), 'utf8');
    expect(body).toMatch(/platform_history_seq/);
    expect(body).toMatch(/platform_object_history/);
    expect(body).toMatch(/read_seq/);
    expect(body).not.toMatch(FORBIDDEN);
  });
});
