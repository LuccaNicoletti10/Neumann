#!/usr/bin/env node
/**
 * delta-storage — src/cli.ts
 * demo: BASE → Δ → compact → reconstruct byte-for-byte.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createDeltaTree } from './core/tree.js';

const USAGE = `delta-storage (delta) — PASSO 9: Delta tree + compactação
  US 11,397,717 / US 9,367,463 / US 9,652,291

Uso:
  delta demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const tree = createDeltaTree({
    fanout: 3,
    maxLevel: 2,
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });

  log('== 1. BASE ==');
  const item = tree.createItem('orders', { id: 1, total: 10, city: 'NY' });
  log(`  item=${item.id} baseHash=${item.base.checksum.slice(0, 12)}…`);

  log('== 2. append Δ1..Δ9 ==');
  const states = [
    { id: 1, total: 11, city: 'NY' },
    { id: 1, total: 12, city: 'NY' },
    { id: 1, total: 12, city: 'SF' },
    { id: 1, total: 13, city: 'SF' },
    { id: 1, total: 14, city: 'SF' },
    { id: 1, total: 15, city: 'SF' },
    { id: 1, total: 16, city: 'LA' },
    { id: 1, total: 17, city: 'LA' },
    { id: 1, total: 18, city: 'LA' },
  ];
  for (const s of states) {
    tree.appendState(item.id, s);
  }
  log(`  headUpdate=${item.headUpdate} individuals=${tree.listIndividuals(item.id).length}`);

  log('== 3. combined (fanout=3) ==');
  const combined = tree.listCombined(item.id);
  for (const c of combined) {
    log(`  L${c.level} Δ${c.startUpdate}-${c.endUpdate} children=${c.childrenIds.length}`);
  }

  log('== 4. reconstruct vs linear (byte-for-byte) ==');
  const target = 7;
  const efficient = tree.reconstruct(item.id, target);
  const linear = tree.reconstructLinear(item.id, target);
  const same = efficient.bytes.equals(linear.bytes);
  log(
    `  target=${target} sameBytes=${String(same)}` +
      ` usedCombined=${efficient.usedCombined} usedIndividuals=${efficient.usedIndividuals}` +
      ` hash=${efficient.checksum.slice(0, 12)}…`,
  );

  log('== 5. zero-copy cache ==');
  const a = tree.cache.put(Buffer.from('shared-payload'));
  const b = tree.cache.put(Buffer.from('shared-payload'));
  log(`  sameRef=${String(a.bytes === b.bytes)} cacheSize=${tree.cache.size()}`);

  log('== demo ok ==');
  return same ? 0 : 1;
}

export async function runCommandLine(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  try {
    switch (cmd) {
      case 'demo':
        return runDemo(log);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        log(USAGE);
        return cmd === undefined ? 2 : 0;
      default:
        error(USAGE);
        return 2;
    }
  } catch (err) {
    error(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
