#!/usr/bin/env node
/**
 * knowledge-graph — src/cli.ts
 * demo: grafo Object→Link→Object → multi-hop → integrity → migrate → remote ref + CTE SQL.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createKnowledgeGraph } from './core/store.js';

const USAGE = `knowledge-graph (kg / links) — PASSO 19: Links + Knowledge Graph
  US20250077899A1 / US 9,378,526 / US 9,621,676 / US 9,906,623

Uso:
  kg demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const g = createKnowledgeGraph({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });

  log('== 1. materializar Object→Link→Object (FK cruzada) ==');
  g.upsertObject({
    id: 'obj-A',
    objectTypeId: 'ot.org',
    primaryKey: 'A',
    properties: { name: 'Acme' },
  });
  g.upsertObject({
    id: 'obj-B',
    objectTypeId: 'ot.org',
    primaryKey: 'B',
    properties: { name: 'Beta' },
  });
  g.upsertObject({
    id: 'obj-C',
    objectTypeId: 'ot.org',
    primaryKey: 'C',
    properties: { name: 'Gamma' },
  });
  g.upsertLink({
    linkTypeId: 'lt.parent_of',
    sourceObjectId: 'obj-A',
    targetObjectId: 'obj-B',
    mappingVersionId: 'mapv-1',
    datasetVersionId: 'dv-1',
    sourceDatasetId: 'ds-crm',
    targetDatasetId: 'ds-crm',
  });
  g.upsertLink({
    linkTypeId: 'lt.parent_of',
    sourceObjectId: 'obj-B',
    targetObjectId: 'obj-C',
    mappingVersionId: 'mapv-1',
    datasetVersionId: 'dv-1',
  });

  log('== 2. integridade referencial ==');
  let integrityDenied = false;
  try {
    g.upsertLink({
      linkTypeId: 'lt.parent_of',
      sourceObjectId: 'obj-A',
      targetObjectId: 'obj-MISSING',
      mappingVersionId: 'mapv-1',
    });
  } catch {
    integrityDenied = true;
  }
  const report = g.checkIntegrity();
  log(`  dangling rejected=${integrityDenied} check.ok=${report.ok} links=${report.linkCount}`);

  log('== 3. traverse multi-hop (recursive CTE semantics) ==');
  const trav = g.traverseLinks({
    startObjectId: 'obj-A',
    linkTypeIds: ['lt.parent_of'],
    maxHops: 2,
    direction: 'outgoing',
  });
  log(
    `  nodes=${trav.nodes.map((n) => n.primaryKey).join('→')} depth=${trav.maxDepthReached} hops=${trav.hops.length}`,
  );
  const sql = g.toRecursiveCteSql({
    startObjectId: 'obj-A',
    linkTypeIds: ['lt.parent_of'],
    maxHops: 2,
    direction: 'outgoing',
  });
  log(`  cte has WITH RECURSIVE=${sql.includes('WITH RECURSIVE')}`);

  log('== 4. link migration mapv-1 → mapv-2 ==');
  const mig = g.migrateLinks({
    fromMappingVersionId: 'mapv-1',
    toMappingVersionId: 'mapv-2',
    linkTypeMap: { 'lt.parent_of': 'lt.parent_of_v2' },
    dropOld: true,
  });
  const after = g.listLinks({ mappingVersionId: 'mapv-2' });
  const oldLeft = g.listLinks({ mappingVersionId: 'mapv-1' });
  log(`  migrated=${mig.migrated} mapv2=${after.length} mapv1left=${oldLeft.length}`);

  log('== 5. remote reference (ticket/proxy) ==');
  const ref = g.createRemoteReference('obj-C');
  const resolved = g.resolveRemoteReference(ref.ticketId);
  const name = g.accessRemote(ref.ticketId, 'name');
  log(`  ticket=${ref.ticketId} pk=${resolved?.primaryKey} name=${String(name)}`);

  const trav2 = g.traverseLinks({
    startObjectId: 'obj-A',
    linkTypeIds: ['lt.parent_of_v2'],
    maxHops: 2,
  });

  const ok =
    integrityDenied &&
    report.ok &&
    trav.maxDepthReached === 2 &&
    trav.nodes.length === 3 &&
    sql.includes('WITH RECURSIVE') &&
    mig.migrated === 2 &&
    after.length === 2 &&
    oldLeft.length === 0 &&
    resolved?.primaryKey === 'C' &&
    name === 'Gamma' &&
    trav2.maxDepthReached === 2;

  log(ok ? 'demo ok' : 'demo FAIL');
  return ok ? 0 : 1;
}

export function runCommandLine(argv: readonly string[], deps: CliDeps = {}): number {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') return runDemo(log);
  error(`comando desconhecido: ${cmd}`);
  log(USAGE);
  return 1;
}

function isMain(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = runCommandLine(process.argv.slice(2));
}
