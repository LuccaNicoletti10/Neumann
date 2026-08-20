#!/usr/bin/env node
/**
 * query-api — src/cli.ts
 * demo: índice ACL + 6 superfícies + Search Around + freshness + p95.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SearchPrincipal } from 'contracts';

import { createDeterministicClock, createIdGenerator, percentile } from './core/determinism.js';
import { createQueryEngine } from './core/engine.js';
import { parseNaturalQuery } from './core/nl-parse.js';
import { generateSearchTemplate } from './core/templates.js';

const USAGE = `query-api (search) — PASSO 29: índice permission-aware + Query API
  US 9,031,981 / US 9,798,768 / US 8,868,537 / US 9,262,529 / US 10,726,032
  US 9,619,557 / US 8,041,714 / US 11,238,102

Uso:
  search demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const SECRET = 'LEAK-TOKEN-SECRETCO';
const P95_TARGET_MS = 50;

const alice: SearchPrincipal = { id: 'alice', groups: ['analysts'], viewingLevel: 'Confidential' };
const bob: SearchPrincipal = { id: 'bob', groups: ['analysts'], viewingLevel: 'Unclassified' };

function leakCount(payload: unknown, needle: string): number {
  return JSON.stringify(payload).includes(needle) ? 1 : 0;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock('2024-06-01T12:00:00.000Z');
  const engine = createQueryEngine({ clock, nextId: createIdGenerator() });

  log('== 1. indexar documentos (ACL + classificação) ==');
  engine.upsert({
    id: 'obj-c1',
    objectTypeId: 'ot.customer',
    primaryKey: 'C1',
    properties: { name: 'Acme', status: 'active', note: 'public note' },
    aclPrincipals: ['alice', 'bob', 'analysts'],
    classification: 'Unclassified',
    sourceUpdatedAt: '2024-06-01T11:59:00.000Z',
  });
  engine.upsert({
    id: 'obj-c2',
    objectTypeId: 'ot.customer',
    primaryKey: 'C2',
    properties: { name: 'SecretCo', status: 'vip', note: SECRET },
    aclPrincipals: ['alice'],
    classification: 'Confidential',
    sourceUpdatedAt: '2024-06-01T11:59:30.000Z',
  });
  engine.upsert({
    id: 'obj-so1',
    objectTypeId: 'ot.sales_order',
    primaryKey: 'SO-1',
    properties: { name: 'Order Acme', status: 'open', amount: 1200 },
    aclPrincipals: ['alice', 'bob', 'analysts'],
    classification: 'Unclassified',
    sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
  });
  engine.upsert({
    id: 'obj-n1',
    objectTypeId: 'ot.internal_note',
    primaryKey: 'N1',
    properties: { name: 'Watchlist', body: SECRET },
    aclPrincipals: ['alice'],
    classification: 'Confidential',
    sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
  });
  engine.upsertLink({
    linkTypeId: 'lt.placed',
    sourceObjectId: 'obj-c1',
    targetObjectId: 'obj-so1',
  });
  engine.upsertLink({
    linkTypeId: 'lt.noted',
    sourceObjectId: 'obj-c1',
    targetObjectId: 'obj-n1',
  });

  const tpl = generateSearchTemplate('ot.sales_order', ['status']);
  engine.registerTemplate(tpl);

  log('== 2. Query API / planner ==');
  const aliceHits = engine.execute(
    { q: 'acme', facetFields: ['status', 'name'], limit: 10 },
    alice,
  );
  const bobHits = engine.execute(
    { q: 'acme', facetFields: ['status', 'name'], limit: 10 },
    bob,
  );
  log(`  alice backend=${aliceHits.metadata.backend} hits=${aliceHits.hits.length}`);
  log(`  bob   backend=${bobHits.metadata.backend} hits=${bobHits.hits.length}`);

  const bobSecret = engine.execute({ q: SECRET, facetFields: ['name'] }, bob);
  const aliceSecret = engine.execute({ q: 'SecretCo', facetFields: ['name'] }, alice);
  log(`  bob q=secret hits=${bobSecret.hits.length} (esperado 0)`);
  log(`  alice SecretCo hits=${aliceSecret.hits.length}`);

  log('== 3. Search Around (grafo) ==');
  const aroundAlice = engine.execute({ searchAround: { objectId: 'obj-c1', maxHops: 1 } }, alice);
  const aroundBob = engine.execute({ searchAround: { objectId: 'obj-c1', maxHops: 1 } }, bob);
  log(`  around alice=${aroundAlice.hits.map((h) => h.primaryKey).join(',')}`);
  log(`  around bob  =${aroundBob.hits.map((h) => h.primaryKey).join(',')}`);

  log('== 4. template + NL parse ==');
  const fromNl = parseNaturalQuery('type:ot.sales_order status=open');
  const nlResp = engine.execute(fromNl, bob);
  const tplResp = engine.execute(
    { templateId: tpl.id, templateParams: { status: 'open' } },
    bob,
  );
  log(`  nl hits=${nlResp.hits.map((h) => h.primaryKey).join(',')}`);
  log(`  tpl hits=${tplResp.hits.map((h) => h.primaryKey).join(',')}`);

  log('== 5. key-phrases (autorizadas) ==');
  const kpAlice = engine.keyPhrases(alice);
  const kpBob = engine.keyPhrases(bob);
  log(`  alice phrases=${kpAlice.join(',')}`);
  log(`  bob phrases=${kpBob.join(',')}`);

  log('== 6. freshness + p95 ==');
  const lag = engine.indexFreshnessLagMs();
  const samples: number[] = [];
  for (let i = 0; i < 30; i++) {
    samples.push(engine.execute({ q: 'acme' }, bob).metadata.tookMs);
  }
  const p95 = percentile(samples, 95);
  log(`  indexLagMs=${lag} p95Ms=${p95} target=${P95_TARGET_MS}`);

  const leaks =
    leakCount(bobHits, SECRET) +
    leakCount(bobSecret, SECRET) +
    leakCount(aroundBob, SECRET) +
    leakCount(bobHits, 'SecretCo') +
    leakCount(bobSecret, 'SecretCo') +
    leakCount(aroundBob, 'SecretCo') +
    leakCount(kpBob, SECRET) +
    leakCount(kpBob, 'secretco');

  const bobSurfacesOk =
    bobHits.hits.every((h) => h.primaryKey !== 'C2' && h.primaryKey !== 'N1') &&
    bobSecret.hits.length === 0 &&
    aroundBob.hits.every((h) => h.primaryKey === 'SO-1') &&
    !bobHits.facets.some((f) => f.values.some((v) => v.value === 'SecretCo' || v.value === SECRET)) &&
    !bobHits.autocomplete.some((s) => s.text.includes('SecretCo') || s.text.includes(SECRET)) &&
    !bobHits.suggestions.some((s) => s.text.includes('SecretCo') || s.text.includes(SECRET));

  const ok =
    leaks === 0 &&
    bobSurfacesOk &&
    aliceSecret.hits.length === 1 &&
    aroundAlice.hits.length === 2 &&
    nlResp.hits.length === 1 &&
    tplResp.hits.length === 1 &&
    lag > 0 &&
    p95 <= P95_TARGET_MS;

  log(ok ? '== demo ok (leakage=0) ==' : '== demo FAIL ==');
  if (!ok) {
    log(`  leaks=${leaks} bobSurfacesOk=${bobSurfacesOk} lag=${lag} p95=${p95}`);
  }
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
  void runCommandLine(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
      process.exitCode = 1;
    },
  );
}
