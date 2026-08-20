#!/usr/bin/env node
/**
 * knowledge-graph — src/cli.ts
 * demo: grafo Object→Link→Object → multi-hop → integrity → migrate → remote ref + CTE SQL.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { detectRedactionCriteria, redactGraph, sanitizedContainsValue } from './core/redact.js';
import { createKnowledgeGraph } from './core/store.js';

const USAGE = `knowledge-graph (kg / links) — PASSO 19 + PASSO 27: Links + Knowledge Graph + redaction
  US20250077899A1 / US 9,378,526 / US 9,621,676 / US 9,906,623
  US 9,501,761 / US 9,857,960 (grafo redigido)

Uso:
  kg demo
  kg redact
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export async function runDemo(log: (message: string) => void = console.log): Promise<number> {
  const g = createKnowledgeGraph({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });

  log('== 1. materializar Object→Link→Object (FK cruzada) ==');
  await g.upsertObject({
    id: 'obj-A',
    objectTypeId: 'ot.org',
    primaryKey: 'A',
    properties: { name: 'Acme' },
  });
  await g.upsertObject({
    id: 'obj-B',
    objectTypeId: 'ot.org',
    primaryKey: 'B',
    properties: { name: 'Beta' },
  });
  await g.upsertObject({
    id: 'obj-C',
    objectTypeId: 'ot.org',
    primaryKey: 'C',
    properties: { name: 'Gamma' },
  });
  await g.upsertLink({
    linkTypeId: 'lt.parent_of',
    sourceObjectId: 'obj-A',
    targetObjectId: 'obj-B',
    mappingVersionId: 'mapv-1',
    datasetVersionId: 'dv-1',
    sourceDatasetId: 'ds-crm',
    targetDatasetId: 'ds-crm',
  });
  await g.upsertLink({
    linkTypeId: 'lt.parent_of',
    sourceObjectId: 'obj-B',
    targetObjectId: 'obj-C',
    mappingVersionId: 'mapv-1',
    datasetVersionId: 'dv-1',
  });

  log('== 2. integridade referencial ==');
  let integrityDenied = false;
  try {
    await g.upsertLink({
      linkTypeId: 'lt.parent_of',
      sourceObjectId: 'obj-A',
      targetObjectId: 'obj-MISSING',
      mappingVersionId: 'mapv-1',
    });
  } catch {
    integrityDenied = true;
  }
  const report = await g.checkIntegrity();
  log(`  dangling rejected=${integrityDenied} check.ok=${report.ok} links=${report.linkCount}`);

  log('== 3. traverse multi-hop (recursive CTE semantics) ==');
  const trav = await g.traverseLinks({
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
  const mig = await g.migrateLinks({
    fromMappingVersionId: 'mapv-1',
    toMappingVersionId: 'mapv-2',
    linkTypeMap: { 'lt.parent_of': 'lt.parent_of_v2' },
    dropOld: true,
  });
  const after = await g.listLinks({ mappingVersionId: 'mapv-2' });
  const oldLeft = await g.listLinks({ mappingVersionId: 'mapv-1' });
  log(`  migrated=${mig.migrated} mapv2=${after.length} mapv1left=${oldLeft.length}`);

  log('== 5. remote reference (ticket/proxy) ==');
  const ref = await g.createRemoteReference('obj-C');
  const resolved = await g.resolveRemoteReference(ref.ticketId);
  const name = await g.accessRemote(ref.ticketId, 'name');
  log(`  ticket=${ref.ticketId} pk=${resolved?.primaryKey} name=${String(name)}`);

  const trav2 = await g.traverseLinks({
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

export function runRedactDemo(log: (message: string) => void = console.log): number {
  log('== PASSO 27: grafo sanitizado (redaction) ==');
  const secret = 'c1@internal.example';
  const nodes = [
    {
      id: 'obj-c1',
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      sourceSystem: 'crm',
      classification: 'Unclassified' as const,
      properties: { name: 'Acme', email: secret },
      propertyClassifications: { email: 'Confidential' },
    },
    {
      id: 'obj-so1',
      objectTypeId: 'ot.sales_order',
      primaryKey: 'SO-1',
      sourceSystem: 'erp',
      classification: 'Unclassified' as const,
      properties: { amount: 1200 },
    },
    {
      id: 'obj-note',
      objectTypeId: 'ot.internal_note',
      primaryKey: 'N1',
      classification: 'Confidential' as const,
      properties: { text: 'internal' },
    },
  ];
  const links = [
    {
      id: 'link-placed',
      linkTypeId: 'lt.placed',
      sourceObjectId: 'obj-c1',
      targetObjectId: 'obj-so1',
      mappingVersionId: 'mv1',
    },
    {
      id: 'link-note',
      linkTypeId: 'lt.annotated',
      sourceObjectId: 'obj-c1',
      targetObjectId: 'obj-note',
      mappingVersionId: 'mv1',
    },
  ];

  const detected = detectRedactionCriteria(nodes);
  log(`  critérios detectados: ${detected.map((c) => c.kind).join(',')}`);

  const alice = redactGraph(nodes, links, { viewingLevel: 'Confidential' });
  const bob = redactGraph(nodes, links, { viewingLevel: 'Unclassified' });
  const bobIds = new Set(bob.nodes.map((n) => n.id));
  const dangling = bob.links.some(
    (l) => !bobIds.has(l.sourceObjectId) || !bobIds.has(l.targetObjectId),
  );
  const leak = sanitizedContainsValue(bob, secret);
  log(
    `  alice nodes=${alice.nodes.length} links=${alice.links.length} email=${Boolean(alice.nodes.find((n) => n.id === 'obj-c1')?.properties?.email)}`,
  );
  log(
    `  bob nodes=${bob.nodes.length} links=${bob.links.length} redactedNodes=${bob.redactedNodeIds.join(',')} dangling=${dangling} leak=${leak}`,
  );

  const ok =
    alice.nodes.length === 3 &&
    alice.links.length === 2 &&
    Boolean(alice.nodes.find((n) => n.id === 'obj-c1')?.properties?.email) &&
    !bob.nodes.some((n) => n.id === 'obj-note') &&
    !bob.nodes.some((n) => n.properties && 'email' in n.properties) &&
    bob.links.length === 1 &&
    bob.links[0]?.id === 'link-placed' &&
    !dangling &&
    !leak;
  log(ok ? 'redact ok' : 'redact FAIL');
  return ok ? 0 : 1;
}

export async function runCommandLine(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') return await runDemo(log);
  if (cmd === 'redact') return runRedactDemo(log);
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

/**
 * Process entry. WHY a named function and not top-level await: this module is
 * also loaded through a CJS interop path, where top-level await cannot be
 * transformed. A rejection here is fatal by design — the CLI must not exit 0.
 */
export async function runMain(argv: readonly string[]): Promise<void> {
  process.exitCode = await runCommandLine(argv);
}

if (isMain()) {
  void runMain(process.argv.slice(2));
}
