#!/usr/bin/env node
/**
 * connector-postgres — src/cli.ts
 * demo + gate T1.3 (abort @ 10_000, restart, continue).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createFixedClock,
  createIdGenerator,
  createMemoryCheckpointStore,
  runSnapshot,
  asConnectorV2,
} from 'connector-sdk';
import type { ObjectRef } from 'contracts';

import { createPostgresConnector } from './core/connector.js';
import {
  createMemorySqlClient,
  type MemoryPersonRow,
} from './core/sql-client.js';

const USAGE = `connector-postgres — snapshot + CDC + checkpoint (Passo 6 / T1.3)

Uso:
  connector-postgres demo
  connector-postgres gate-t1.3 [--rows <n>] [--abort <n>]

CONNECTOR_PROTOCOL=v2 usa SPEC/CHECK/DISCOVER/READ no demo (v1 continua o default).
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const PEOPLE_COLUMNS = [
  { name: 'id', dataType: 'text', nullable: false, isPrimaryKey: true },
  { name: 'name', dataType: 'text', nullable: false },
  { name: 'email', dataType: 'text', nullable: false },
  { name: 'updated_at', dataType: 'timestamptz', nullable: false },
  { name: 'deleted_at', dataType: 'timestamptz', nullable: true },
];

function seedPeople(n: number, baseIso = '2024-01-01T00:00:00.000Z'): MemoryPersonRow[] {
  const base = Date.parse(baseIso);
  const rows: MemoryPersonRow[] = [];
  for (let i = 1; i <= n; i += 1) {
    const updated = new Date(base + i * 1000).toISOString();
    rows.push({
      id: String(i),
      name: `Person ${i}`,
      email: `p${i}@example.com`,
      updated_at: updated,
      deleted_at: null,
    });
  }
  return rows;
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function runDemo(log: (message: string) => void): Promise<number> {
  const client = createMemorySqlClient(seedPeople(5));
  const connector = createPostgresConnector({
    connectorId: 'pg-demo',
    sourceSystem: 'crm',
    tables: [{ name: 'people', primaryKey: 'id', columns: PEOPLE_COLUMNS }],
    client,
    pageSize: 2,
    clock: createFixedClock('2024-06-01T00:00:00.000Z'),
    nextId: createIdGenerator(),
  });

  log('== discover ==');
  for (const o of await connector.discover()) log(`  ${o.sourceSystem}.${o.name}`);

  log('== schema ==');
  const schema = await connector.schema({ sourceSystem: 'crm', objectName: 'people' });
  for (const c of schema.columns) {
    log(`  ${c.name}: ${c.dataType}${c.isPrimaryKey ? ' [PK]' : ''}`);
  }

  log('== snapshot (pageSize=2) ==');
  let n = 0;
  for await (const ev of connector.snapshot({ sourceSystem: 'crm', objectName: 'people' })) {
    n += 1;
    log(`  #${n} pk=${ev.source_primary_key} hash=${ev.payload_hash.slice(0, 12)}…`);
  }
  const cp = await connector.checkpoint();
  log(`checkpoint=${cp.token}`);
  log(`health=${(await connector.health()).state}`);
  log('ok');
  return 0;
}

async function runDemoV2(log: (message: string) => void): Promise<number> {
  const connector = createPostgresConnector({
    connectorId: 'pg-demo',
    sourceSystem: 'crm',
    tables: [{ name: 'people', primaryKey: 'id', columns: PEOPLE_COLUMNS }],
    client: createMemorySqlClient(seedPeople(5)),
    pageSize: 2,
    clock: createFixedClock('2024-06-01T00:00:00.000Z'),
    nextId: createIdGenerator(),
  });
  const v2 = asConnectorV2(connector, '2.0.0');
  const spec = await v2.spec();
  log(`== v2 spec ${spec.connectorId}@${spec.version} ==`);
  const check = await v2.check();
  log(`check ok=${check.ok}`);
  for (const s of await v2.discover()) log(`  stream ${s.sourceSystem}.${s.name}`);
  let records = 0;
  for await (const msg of v2.read({ fullRefresh: true })) {
    if (msg.type === 'RECORD') records += 1;
    if (msg.type === 'ERROR') {
      log(`error ${msg.message}`);
      return 1;
    }
  }
  log(`read records=${records}`);
  log('ok');
  return check.ok && records === 5 ? 0 : 1;
}

/**
 * Gate T1.3: seed N rows; abort após A eventos; reinicia com checkpoint; sem dupes/skips.
 */
export async function runGateT13(options: {
  rows: number;
  abortAfter: number;
  log: (message: string) => void;
}): Promise<{ ok: boolean; unique: number; duplicates: number; total: number }> {
  const { rows: rowCount, abortAfter, log } = options;
  const client = createMemorySqlClient(seedPeople(rowCount));
  const store = createMemoryCheckpointStore();
  const object: ObjectRef = { sourceSystem: 'crm', objectName: 'people' };
  const pageSize = 1000;

  const make = (initialCursorToken?: string) =>
    createPostgresConnector({
      connectorId: 'pg-t13',
      sourceSystem: 'crm',
      tables: [{ name: 'people', primaryKey: 'id', columns: PEOPLE_COLUMNS }],
      client,
      pageSize,
      clock: createFixedClock('2024-06-01T00:00:00.000Z'),
      nextId: createIdGenerator(),
      initialCursorToken,
    });

  log(`== T1.3 seed ${rowCount} rows; abort @ ${abortAfter} ==`);
  const first = await runSnapshot({
    connector: make(),
    store,
    object,
    abortAfter,
    persistEvery: 100,
  });
  log(`  phase1 events=${first.events.length} aborted=${first.aborted} cp=${first.checkpoint.token}`);

  const second = await runSnapshot({
    connector: make(first.checkpoint.token),
    store,
    object,
    persistEvery: 100,
  });
  log(`  phase2 events=${second.events.length} aborted=${second.aborted}`);

  const combined = [...first.events, ...second.events];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const e of combined) {
    if (seen.has(e.source_primary_key)) duplicates += 1;
    else seen.add(e.source_primary_key);
  }
  const ok = seen.size === rowCount && duplicates === 0 && combined.length === rowCount;
  log(`  total=${combined.length} unique=${seen.size} duplicates=${duplicates} ok=${ok}`);
  return { ok, unique: seen.size, duplicates, total: combined.length };
}

export async function runCommandLine(
  argv: readonly string[] = [],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => console.log(m));
  const error = deps.error ?? ((m) => console.error(m));
  const args = argv.filter((a) => a !== '--');
  const cmd = args[0];
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    log(USAGE);
    return cmd === undefined ? 1 : 0;
  }
  if (cmd === 'demo') {
    if (process.env.CONNECTOR_PROTOCOL === 'v2') return runDemoV2(log);
    return runDemo(log);
  }
  if (cmd === 'gate-t1.3') {
    const rows = Number(flagValue(args, '--rows') ?? '15000');
    const abortAfter = Number(flagValue(args, '--abort') ?? '10000');
    const result = await runGateT13({ rows, abortAfter, log });
    if (!result.ok) return 1;
    if (process.env.CONNECTOR_PROTOCOL === 'v2') {
      const v2 = asConnectorV2(
        createPostgresConnector({
          connectorId: 'pg-t13',
          sourceSystem: 'crm',
          tables: [{ name: 'people', primaryKey: 'id', columns: PEOPLE_COLUMNS }],
          client: createMemorySqlClient(seedPeople(rows)),
          pageSize: 1000,
          clock: createFixedClock('2024-06-01T00:00:00.000Z'),
          nextId: createIdGenerator(),
        }),
        '2.0.0',
      );
      let n = 0;
      for await (const msg of v2.read({ fullRefresh: true })) {
        if (msg.type === 'RECORD') n += 1;
      }
      log(`  v2 full-refresh records=${n}`);
      if (n !== rows) return 1;
    }
    return 0;
  }
  error(`comando desconhecido: ${cmd}`);
  log(USAGE);
  return 1;
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
