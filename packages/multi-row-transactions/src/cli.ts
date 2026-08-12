#!/usr/bin/env node
/**
 * multi-row-transactions — src/cli.ts
 * demo: transferência multi-row + snapshot(at) + replay.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createMultiRowTransactionSystem } from './core/system.js';

const USAGE = `multi-row-transactions (mrtx/tt) — PASSO 10: time travel + multi-row tx
  US 8,504,542 / US 9,619,507

Uso:
  mrtx demo
  tt demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock('2024-01-01T14:37:00.000Z');
  const sys = createMultiRowTransactionSystem({
    clock,
    nextId: createIdGenerator(),
    tables: ['accounts'],
  });

  log('== 1. seed Alice/Bob ==');
  const init = sys.startTransaction();
  sys.set(init, 'accounts', 'Alice', 'BankBalance', 12);
  sys.set(init, 'accounts', 'Bob', 'BankBalance', 13);
  const okInit = sys.commit(init);
  log(`  initCommitted=${String(okInit)} startTs=${init.startTs} commitTs=${init.commitTs}`);

  log('== 2. transfer $10 Bob→Alice (multi-row atomic) ==');
  const tx = sys.startTransaction();
  const alice = sys.get(tx, 'accounts', 'Alice', 'BankBalance') as number;
  const bob = sys.get(tx, 'accounts', 'Bob', 'BankBalance') as number;
  sys.set(tx, 'accounts', 'Alice', 'BankBalance', alice + 10);
  sys.set(tx, 'accounts', 'Bob', 'BankBalance', bob - 10);
  const ok = sys.commit(tx);
  log(`  committed=${String(ok)} Alice=${alice + 10} Bob=${bob - 10}`);

  log('== 3. snapshot(at) determinístico ==');
  const snap = sys.snapshot({
    dataset: 'accounts',
    at: tx.commitTs!,
  });
  log(
    `  at=${String(snap.at)} logical=${snap.logicalTimestamp}` +
      ` hash=${snap.contentHash.slice(0, 12)}…` +
      ` Alice=${String(snap.rows['Alice']?.['BankBalance'])}` +
      ` Bob=${String(snap.rows['Bob']?.['BankBalance'])}`,
  );
  const snap2 = sys.snapshot({
    dataset: 'accounts',
    at: tx.commitTs!,
  });
  const snapIso = sys.snapshot({
    dataset: 'accounts',
    at: '2024-01-01T14:37:22.000Z',
  });
  log(
    `  sameHash=${String(snap.contentHash === snap2.contentHash)}` +
      ` isoHashPrefix=${snapIso.contentHash.slice(0, 12)}…`,
  );

  log('== 4. replay + diff ==');
  const rep = sys.replay('accounts');
  log(`  replayHash=${rep.contentHash.slice(0, 12)}… txs=${rep.transactionsReplayed}`);
  const d = sys.diffVersions('accounts', init.commitTs!, tx.commitTs!);
  log(`  changedCells=${d.changedCells.map((c) => `${c.row}.${c.column}`).join(',')}`);

  log('== 5. crash entre write e commit ==');
  const crashTx = sys.startTransaction();
  sys.set(crashTx, 'accounts', 'Alice', 'BankBalance', 999);
  sys.crashBeforeCommitFinalize(crashTx);
  const afterCrash = sys.startTransaction();
  const aliceAfter = sys.get(afterCrash, 'accounts', 'Alice', 'BankBalance');
  sys.abort(afterCrash);
  log(`  aliceAfterCrash=${String(aliceAfter)} (esperado 22, não 999)`);

  log('== demo ok ==');
  return aliceAfter === 22 && snap.contentHash === snap2.contentHash && ok ? 0 : 1;
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
