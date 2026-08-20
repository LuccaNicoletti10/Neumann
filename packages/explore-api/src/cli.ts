#!/usr/bin/env node
/**
 * explore-api — src/cli.ts
 * demo: padrão de grafo + índice em blocos + scoring + path (sem GUI/app).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildGoldenGraphPattern, type GraphPattern } from 'contracts';
import { createOntologyAuthorizer } from 'policy-engine';

import {
  bindSlot,
  createBindingStore,
  evaluateExpression,
  projectObject,
  setExpression,
  suggestBindings,
} from './core/bindings.js';
import { createIdGenerator } from './core/determinism.js';
import {
  buildInvestigationIndex,
  singleLevelSearch,
  transformTokens,
  twoLevelSearch,
} from './core/investigation.js';
import { executeGraphPattern } from './core/pattern.js';
import { computeObjectScores, updateWeight, type RegisteredMetric } from './core/scorer.js';
import { EXPLORE_SECRET, seedExploreCatalog } from './core/seed.js';

const USAGE = `explore-api (explore) — PASSO 30: APIs de exploração genéricas
  US 8,799,240 / US 9,639,580 / US 9,280,532 / US 9,880,993

Uso:
  explore demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

function leakCount(payload: unknown, needle: string): number {
  if (payload === undefined || payload === null) return 0;
  return JSON.stringify(payload).toLowerCase().includes(needle.toLowerCase()) ? 1 : 0;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const catalog = seedExploreCatalog();
  const authorizer = createOntologyAuthorizer({
    roles: { alice: ['financeiro'], bob: ['ops'] },
    grants: [
      {
        role: 'financeiro',
        ontologyIds: ['ont-sales'],
        objectTypes: ['ot.customer', 'ot.sales_order', 'ot.internal_note'],
        operations: ['read', 'modify'],
      },
      {
        role: 'ops',
        ontologyIds: ['ont-sales'],
        objectTypes: ['ot.customer', 'ot.sales_order'],
        operations: ['read'],
        hiddenProperties: ['internal'],
      },
    ],
  });

  const pattern: GraphPattern = {
    ...buildGoldenGraphPattern(),
    edges: [
      { id: 'e1', source: 'c', target: 'o', linkTypeId: 'lt.placed' },
      { id: 'e2', source: 'c', target: 'n', linkTypeId: 'lt.noted', optional: true },
    ],
    nodes: [
      { id: 'c', objectTypeId: 'ot.customer' },
      {
        id: 'o',
        objectTypeId: 'ot.sales_order',
        matches: [{ property: 'status', operator: 'eq', value: 'open' }],
      },
      { id: 'n', objectTypeId: 'ot.internal_note' },
    ],
  };

  log('== 1. GraphPattern (customer → open order, note opcional) ==');
  const alicePat = executeGraphPattern({ catalog, pattern, principal: 'alice', authorizer });
  const bobPat = executeGraphPattern({ catalog, pattern, principal: 'bob', authorizer });
  log(`  alice matches=${alicePat.total}`);
  log(`  bob   matches=${bobPat.total}`);

  log('== 2. Investigation index (blocos + 1/2 níveis) ==');
  const index = buildInvestigationIndex(catalog, {
    nextId: createIdGenerator(),
    transforms: [{ type: 'canonicalize', toLower: true }, { type: 'truncate', maxLength: 40 }],
  });
  const aliceInv = singleLevelSearch(catalog, index, 'acme', 'alice', authorizer);
  const bobInv = singleLevelSearch(catalog, index, 'watchlist', 'bob', authorizer);
  const bobSecretInv = singleLevelSearch(catalog, index, EXPLORE_SECRET.toLowerCase(), 'bob', authorizer);
  const two = twoLevelSearch(catalog, index, 'acme', 'acme|', 'acme|zzzz', 'bob', authorizer);
  log(`  alice acme hits=${aliceInv.hits.map((h) => h.primaryKey).join(',')}`);
  log(`  bob watchlist hits=${bobInv.total} (esperado 0)`);
  log(`  bob two-level acme hits=${two.total}`);

  log('== 3. Scoring ponderado (orders) ==');
  const metrics: RegisteredMetric[] = [
    {
      id: 'amount',
      name: 'Amount',
      sourceFields: ['amount'],
      defaultWeight: 100,
      score: (v) => Math.min(100, (v.amount ?? 0) / 20),
    },
  ];
  const orders = catalog.objects.filter((o) => o.objectTypeId === 'ot.sales_order');
  const aliceScore = computeObjectScores(orders, metrics, [{ metricId: 'amount', weight: 100 }], 'alice', authorizer);
  const bobScore = computeObjectScores(orders, metrics, [{ metricId: 'amount', weight: 100 }], 'bob', authorizer);
  const bumped = updateWeight(
    bobScore,
    [{ metricId: 'amount', weight: 100 }],
    'amount',
    50,
    orders,
    metrics,
    'bob',
    authorizer,
  );
  log(`  alice rank1=${aliceScore.scores[0]?.primaryKey} weighted=${aliceScore.scores[0]?.totalWeighted}`);
  log(`  bob   rank1=${bobScore.scores[0]?.primaryKey} afterWeight50=${bumped.result.scores[0]?.totalWeighted}`);

  log('== 4. Rich object path + projeção ==');
  const store = createBindingStore();
  const so1 = catalog.objects.find((o) => o.primaryKey === 'SO-1')!;
  bindSlot(store, 'o1', so1, 'bob', authorizer);
  const amount = evaluateExpression('o1.amount', store, 'bob', authorizer);
  const hidden = evaluateExpression('o1.internal', store, 'bob', authorizer);
  const arith = setExpression(store, 'double', 'o1.amount * 2', 'bob', authorizer);
  const suggest = suggestBindings(store, 'o1.', 'bob', authorizer);
  const projected = projectObject(so1, ['status', 'amount', 'internal'], 'bob', authorizer);
  log(`  bob o1.amount=${String(amount.value)} internal=${String(hidden.value)} double=${String(arith.value)}`);
  log(`  suggest=${suggest.join(',')} projectedKeys=${Object.keys(projected).join(',')}`);

  const transformed = transformTokens(['Acme', 'Order'], [
    { type: 'canonicalize', toLower: true },
    { type: 'concatenate', delimiter: '-' },
  ]);

  const bobBindings = bobPat.matches.flatMap((m) => m.bindings);
  const bobHasNote = bobBindings.some((b) => b.objectTypeId === 'ot.internal_note');
  const leaks =
    leakCount(bobPat, EXPLORE_SECRET) +
    leakCount(bobInv, EXPLORE_SECRET) +
    leakCount(bobSecretInv, EXPLORE_SECRET) +
    leakCount(bobScore, EXPLORE_SECRET) +
    leakCount(hidden.value, EXPLORE_SECRET) +
    leakCount(projected, EXPLORE_SECRET);

  const ok =
    leaks === 0 &&
    !bobHasNote &&
    alicePat.total >= 1 &&
    bobPat.total >= 1 &&
    bobInv.total === 0 &&
    bobSecretInv.total === 0 &&
    aliceInv.hits.some((h) => h.primaryKey === 'C1') &&
    two.total >= 1 &&
    amount.value === 1200 &&
    hidden.value === undefined &&
    arith.value === 2400 &&
    !suggest.includes('internal') &&
    projected.internal === undefined &&
    projected.amount === 1200 &&
    transformed[0] === 'acme-order' &&
    bumped.result.scores[0]!.totalWeighted === bobScore.scores[0]!.totalWeighted * 0.5;

  log(ok ? '== demo ok (leakage=0, sem app) ==' : '== demo FAIL ==');
  if (!ok) {
    log(`  leaks=${leaks} bobHasNote=${bobHasNote} alicePat=${alicePat.total} bobPat=${bobPat.total}`);
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
