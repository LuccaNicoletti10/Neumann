#!/usr/bin/env node
/**
 * entity-resolution — src/cli.ts
 * demo: ACME LTDA + Acme Ltda. → 1 cluster Customer (Passo 20)
 *       + audit persistido + merge/unmerge reversível (Passo 21).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createEntityResolver } from './core/engine.js';
import {
  normalizeDocument,
  normalizeEmail,
  normalizeText,
} from './core/normalize.js';

const USAGE = `entity-resolution (er / resolve) — PASSO 20–21: normalize → block → score → audit/canonical
  US 8,554,719 / 9,501,552 / 9,846,731 / 12,229,154 / US20140280252
  US20250165857A1 / US 12,393,406 / US20250348288A1 / US 8,788,405 / US 8,818,892

Uso:
  er demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const DEMO_RECORDS = [
  {
    id: 'rec-A',
    objectTypeId: 'ot.customer',
    sourceSystem: 'crm-a',
    properties: {
      name: 'ACME LTDA',
      document: '12.345.678/0001-90',
      email: 'Contato@ACME.com.br',
      city: 'São Paulo',
    },
  },
  {
    id: 'rec-B',
    objectTypeId: 'ot.customer',
    sourceSystem: 'crm-b',
    properties: {
      name: 'Acme Ltda.',
      document: '12345678000190',
      email: 'contato@acme.com.br',
      city: 'Sao Paulo',
    },
  },
  {
    id: 'rec-C',
    objectTypeId: 'ot.customer',
    sourceSystem: 'crm-a',
    properties: {
      name: 'Beta Comercio ME',
      document: '98.765.432/0001-10',
      email: 'beta@example.com',
      city: 'Campinas',
    },
  },
] as const;

export function runDemo(log: (message: string) => void = console.log): number {
  const er = createEntityResolver({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });

  log('== 1. normalização ==');
  const nameA = normalizeText('ACME LTDA');
  const nameB = normalizeText('Acme Ltda.');
  const doc = normalizeDocument('12.345.678/0001-90');
  const email = normalizeEmail('Contato@ACME.com.br');
  log(`  nameA="${nameA}" nameB="${nameB}" equal=${nameA === nameB}`);
  log(`  doc=${doc} email=${email}`);

  log('== 2. corpus: ACME LTDA (A) + Acme Ltda. (B) + outlier ==');
  const result = er.runResolution({ records: [...DEMO_RECORDS] });

  log(
    `  normalized=${result.stats.normalizedCount} blocks=${result.stats.blockCount} comparisons=${result.stats.comparisons} cartesian=${result.stats.fullCartesianPairs}`,
  );

  log('== 3. candidatos + decisões ==');
  for (const c of result.candidates) {
    log(
      `  ${c.leftId}↔${c.rightId} score=${c.score.toFixed(3)} → ${c.decision} (${c.blockKey})`,
    );
  }

  log('== 4. soft clusters (originais preservados) ==');
  for (const cl of result.clusters) {
    log(
      `  ${cl.clusterId} type=${cl.objectTypeId} members=[${cl.memberIds.join(',')}] name=${cl.displayName ?? ''}`,
    );
  }

  const acmeCluster = result.clusters.find(
    (c) => c.memberIds.includes('rec-A') && c.memberIds.includes('rec-B'),
  );
  const betaAlone = result.clusters.find(
    (c) => c.memberIds.length === 1 && c.memberIds[0] === 'rec-C',
  );
  const abMatch = result.candidates.find(
    (c) =>
      ((c.leftId === 'rec-A' && c.rightId === 'rec-B') ||
        (c.leftId === 'rec-B' && c.rightId === 'rec-A')) &&
      c.decision === 'match',
  );
  const blockingOk = result.stats.comparisons < result.stats.fullCartesianPairs;
  const namesEqual = nameA === nameB && nameA === 'acme ltda';

  const ok =
    namesEqual &&
    Boolean(abMatch) &&
    Boolean(acmeCluster) &&
    acmeCluster?.memberIds.length === 2 &&
    Boolean(betaAlone) &&
    result.clusters.length === 2 &&
    blockingOk;

  log(
    ok
      ? 'demo ok — ACME LTDA + Acme Ltda. → 1 Customer'
      : 'demo FAIL',
  );
  return ok ? 0 : 1;
}

export async function runAuditDemo(log: (message: string) => void = console.log): Promise<number> {
  const er = createEntityResolver({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });

  log('== 5. Passo 21 — commit audit + fingerprint index ==');
  const result = er.runResolution({ records: [...DEMO_RECORDS] });
  await er.commitRun(result);
  const audit = await er.listMatchAudit({ runId: result.runId });
  log(`  audit rows=${audit.length} model=${audit[0]?.modelVersion ?? ''}`);
  for (const a of audit) {
    log(`  ${a.leftId}↔${a.rightId} ${a.decision} score=${a.score.toFixed(3)} @ ${a.createdAt}`);
  }

  log('== 6. merge canonical (originais intactos) ==');
  const acme = result.clusters.find(
    (c) => c.memberIds.includes('rec-A') && c.memberIds.includes('rec-B'),
  )!;
  const canonical = await er.mergeCanonical({
    objectTypeId: acme.objectTypeId,
    memberIds: acme.memberIds,
    displayName: acme.displayName,
    principal: 'analyst.1',
    reason: 'exact document + fuzzy name',
  });
  log(`  canonical=${canonical.id} members=[${canonical.memberIds.join(',')}]`);
  const linksA = await er.linksForRecord('rec-A');
  const linksB = await er.linksForRecord('rec-B');

  log('== 7. unmerge false merge (reversível) ==');
  const afterUnmerge = await er.unmerge({
    canonicalId: canonical.id,
    recordId: 'rec-B',
    principal: 'analyst.1',
    reason: 'false merge — distinct legal entities',
  });
  const linksBAfter = await er.linksForRecord('rec-B');
  const events = await er.listMergeEvents(canonical.id);

  log('== 8. fingerprint search + cluster rank ==');
  const similar = await er.searchSimilar({
    id: 'q-acme',
    objectTypeId: 'ot.customer',
    properties: { name: 'ACME LTDA', document: '12345678000190' },
  });
  const ranked = er.rankClusters(result.clusters, result.candidates);
  log(`  similar=[${similar.map((s) => `${s.recordId}:${s.score.toFixed(2)}`).join(', ')}]`);
  log(`  ranked=[${ranked.map((r) => `${r.clusterId}:${r.score.toFixed(2)}`).join(', ')}]`);

  const originalsIntact = result.normalized.some((n) => n.recordId === 'rec-A')
    && result.normalized.some((n) => n.recordId === 'rec-B');
  const everyDecisionAudited = audit.length === result.candidates.length
    && audit.every((a) => a.modelVersion && a.reason && a.createdAt);
  const linkedThenUnmerged =
    linksA.some((l) => l.status === 'active' && l.canonicalId === canonical.id)
    && linksB.some((l) => l.status === 'active')
    && linksBAfter.some((l) => l.status === 'unmerged')
    && !linksBAfter.some((l) => l.status === 'active')
    && (afterUnmerge?.memberIds.includes('rec-A') ?? false)
    && !(afterUnmerge?.memberIds.includes('rec-B') ?? true)
    && events.some((e) => e.kind === 'merge')
    && events.some((e) => e.kind === 'unmerge');
  const searchOk = similar.some((s) => s.recordId === 'rec-A' || s.recordId === 'rec-B');
  const rankOk = ranked.length === result.clusters.length;

  const ok =
    originalsIntact &&
    everyDecisionAudited &&
    linkedThenUnmerged &&
    searchOk &&
    rankOk;

  log(
    ok
      ? 'demo ok — audit + canonical + false merge reversível'
      : 'demo FAIL (passo 21)',
  );
  return ok ? 0 : 1;
}

export async function runCommandLine(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') {
    const passo20 = runDemo(log);
    if (passo20 !== 0) return passo20;
    return runAuditDemo(log);
  }
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
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
