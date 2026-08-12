#!/usr/bin/env node
/**
 * entity-resolution — src/cli.ts
 * demo: ACME LTDA + Acme Ltda. → 1 cluster Customer (Passo 20 gate).
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

const USAGE = `entity-resolution (er / resolve) — PASSO 20: normalize → block → score
  US 8,554,719 / 9,501,552 / 9,846,731 / 12,229,154 / US20140280252

Uso:
  er demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

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
  const result = er.runResolution({
    records: [
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
    ],
  });

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
