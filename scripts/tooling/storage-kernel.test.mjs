import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { verifyStorageKernel } from './storage-kernel.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('storage-kernel', () => {
  it('accepts the Neumann production tree', () => {
    const report = verifyStorageKernel(repoRoot);
    assert.equal(report.ok, true, report.errors.join('\n'));
  });

  it('rejects a query-api knowledge-graph import', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'query-api', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'query-api', 'src', 'engine.ts'),
      "import { createKnowledgeGraph } from 'knowledge-graph';\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('knowledge-graph')));
  });

  it('rejects an object Map outside canonical adapters', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'explore-api', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'explore-api', 'src', 'store.ts'),
      'const indexByPk = new Map();\n',
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('PK index')));
  });

  it('rejects a second policy evaluator in platform-api src', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'platform-api', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'context.ts'),
      "import { createPolicyEngine } from 'policy-engine';\ncreatePolicyEngine().hydrate();\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('createPolicyEngine')));
    assert.ok(report.errors.some((e) => e.includes('hydrate')));
  });

  it('rejects a syncValue bridge over an async storage port', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'object-platform', 'src', 'core'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'object-platform', 'src', 'core', 'platform.ts'),
      "const rec = syncValue(objects.getById(id), 'objects.getById');\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('ADR-0013')));
  });

  it('rejects reintroducing the syncValue helper', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'knowledge-graph', 'src', 'core'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'knowledge-graph', 'src', 'core', 'sync-value.ts'),
      'export function syncValue<T>(v: T | Promise<T>): T {\n  return v as T;\n}\n',
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('async-only')));
  });

  it('rejects ontology-registry importing action-engine', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'ontology-registry', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'ontology-registry', 'package.json'),
      JSON.stringify({ name: 'ontology-registry', dependencies: { contracts: 'workspace:*' } }),
    );
    writeFileSync(
      join(root, 'packages', 'ontology-registry', 'src', 'registry.ts'),
      "import { validateActionTypeDefSchema } from 'action-engine';\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('ontology-registry must not import action-engine')));
  });

  it('rejects an ingest route that writes 202 before enqueueWebhook', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'platform-api', 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'routes', 'ingest.ts'),
      "return reply.code(202).send({});\nawait ctx.ingestion.enqueueWebhook({} as never);\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('202 must be after')));
  });

  it('rejects a process-local Function registry on the HTTP path', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'platform-api', 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'routes', 'functions.ts'),
      "import { createFunctionRegistry } from 'function-registry';\ncreateFunctionRegistry();\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('process-local Function registry')));
  });

  it('rejects Function reads that use objects.get instead of history.asOf', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'platform-api', 'src', 'core'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'core', 'context.ts'),
      "createFunctionRuntime({ reads: functionReads(policy, objects) });\n",
    );
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'core', 'function-reads.ts'),
      "const obj = await objects.get(ontologyId, objectTypeId, primaryKey);\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('objects.get')));
    assert.ok(report.errors.some((e) => e.includes('history.asOf')));
  });

  it('rejects Function reads that use SQL', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-storage-'));
    mkdirSync(join(root, 'packages', 'platform-api', 'src', 'core'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'core', 'context.ts'),
      "createFunctionRuntime({ reads: createFunctionObjectReader(policy, history) });\n",
    );
    writeFileSync(
      join(root, 'packages', 'platform-api', 'src', 'core', 'function-reads.ts'),
      "const row = await sql.query('select * from objects');\n",
    );
    const report = verifyStorageKernel(root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('SQL')));
  });
});
