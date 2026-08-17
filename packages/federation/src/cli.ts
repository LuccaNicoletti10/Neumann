#!/usr/bin/env node
/**
 * federation — src/cli.ts
 * demo: T1.5 consultar remoto sem copiar + temp object + promote + ACL.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FederationPrincipal } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { FED_SSN_SECRET, seedFederation } from './core/seed.js';

const USAGE = `federation (fed) — PASSO 31: federation planner + pushdown + temporary objects
  US 10,402,397 / US 11,281,659 / US 11,681,690
  Gate T1.5: consultar registro remoto sem copiá-lo.

Uso:
  fed demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const alice: FederationPrincipal = { id: 'alice', groups: ['analysts'] };
const bob: FederationPrincipal = { id: 'bob', groups: ['analysts'] };

function leakCount(payload: unknown, needle: string): number {
  if (payload === undefined || payload === null) return 0;
  return JSON.stringify(payload).includes(needle) ? 1 : 0;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock();
  const { engine, phone, hr } = seedFederation({
    clock,
    nextId: createIdGenerator(),
    ttlMs: 60_000,
  });

  log('== 1. plan + pushdown (sem snapshot) ==');
  const plan = engine.plan({ objectId: 'P-778', requirePushdown: true });
  log(`  pushdowns=${plan.pushdowns.map((p) => p.sourceId).join(',')}`);
  const views = engine.execute({ objectId: 'P-778', requirePushdown: true }, alice);
  const ada = views[0];
  log(`  temp id=${ada?.id} provenance=${ada?.provenance} copiedExclusive=${engine.sourceHoldsExclusiveCopy('P-778')}`);
  log(`  properties=${Object.keys(ada?.properties ?? {}).join(',')}`);

  log('== 2. T1.5: fonte não copiada ==');
  const snap = engine.snapshotCallCount();
  const materialized = engine.isMaterialized('P-778');
  log(`  snapshotCalls=${snap} materialized=${materialized} phoneHas=${phone.records.has('P-778')} hrHas=${hr.records.has('P-778')}`);

  log('== 3. redaction (Bob não vê SSN) ==');
  const bobView = engine.loadTemporaryObject('P-778', bob);
  const aliceView = engine.loadTemporaryObject('P-778', alice);
  const bobHasSsn = Boolean(bobView && 'properties' in bobView && bobView.properties.ssn);
  const aliceHasSsn = Boolean(aliceView && 'properties' in aliceView && aliceView.properties.ssn);
  log(`  bob hasSsn=${bobHasSsn} alice hasSsn=${aliceHasSsn}`);

  log('== 4. promote (copy-on-write) ==');
  const platform = engine.promote('P-778', alice);
  log(`  copyOnWrite=${platform?.copyOnWrite} promotedBy=${platform?.promotionMetadata.promotedBy}`);

  log('== 5. edit temp + link ausente do store ==');
  engine.applyPromotion('P-778', { type: 'addProperty', key: 'title', value: 'Analyst' });
  const link = engine.displayLink('P-778', 'ghost-obj', 'friend');
  log(`  title=${String(engine.getPlatformObject('P-778')?.properties.title)} absentLink=${link.absentFromStore}`);

  log('== 6. source update + refresh ==');
  phone.upsertRecord({
    objectId: 'P-778',
    fields: { id: 'P-778', name: 'Ada Lovelace', phone: '555-9999' },
    lastUpdated: '2024-06-01T13:00:00.000Z',
    acl: phone.records.get('P-778')!.acl,
  });
  engine.refresh('P-778');
  const refreshed = engine.getPlatformObject('P-778');
  log(`  phone=${String(refreshed?.properties.phone)} title persists=${String(refreshed?.properties.title)}`);

  const bobBlob = JSON.stringify(bobView);
  const leaks = leakCount(bobView, FED_SSN_SECRET) + leakCount(bobBlob, FED_SSN_SECRET);

  const ok =
    snap === 0 &&
    !materialized &&
    phone.federatedQueryCallCount > 0 &&
    ada?.provenance === 'federated' &&
    ada.copyOnWrite === true &&
    engine.sourceHoldsExclusiveCopy('P-778') === false &&
    platform?.copyOnWrite === true &&
    bobView !== null &&
    'properties' in bobView &&
    bobView.properties.ssn === undefined &&
    aliceView !== null &&
    'properties' in aliceView &&
    aliceView.properties.ssn === FED_SSN_SECRET &&
    refreshed?.properties.phone === '555-9999' &&
    refreshed.properties.title === 'Analyst' &&
    link.absentFromStore === true &&
    leaks === 0;

  log(ok ? '== demo ok (T1.5, leakage=0) ==' : '== demo FAIL ==');
  if (!ok) {
    log(
      `  snap=${snap} mat0=${materialized} prov=${ada?.provenance} bobSsn=${String(
        bobView && 'properties' in bobView ? bobView.properties.ssn : undefined,
      )} phone=${String(refreshed?.properties.phone)}`,
    );
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
  runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
