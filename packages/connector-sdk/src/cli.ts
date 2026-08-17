#!/usr/bin/env node
/**
 * connector-sdk — src/cli.ts
 * demo: event factory + checkpoint store.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createMemoryCheckpointStore } from './core/checkpoint-store.js';
import { createFixedClock, createIdGenerator } from './core/determinism.js';
import { createEventFactory } from './core/event-factory.js';
import {
  propertiesToSourceFields,
  sourceFieldsToProperties,
} from './core/inverse-map.js';
import { createMemoryWriteBackConnector } from './core/memory-writeback.js';

const USAGE = `connector-sdk — helpers de Connector (Passo 5 + Passo 25 write-path)

Uso:
  connector-sdk demo
  connector-sdk writeback
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

async function runDemo(log: (message: string) => void): Promise<number> {
  const factory = createEventFactory({
    clock: createFixedClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });
  const event = factory.create({
    source_system: 'crm',
    source_object: 'people',
    source_primary_key: '42',
    schema_version: '1',
    connector_id: 'demo',
    checkpoint: 'snap:people:42',
    principal: 'sa:demo',
    policy_tags: ['demo'],
    payload: { id: 42, name: 'Demo' },
  });
  log(`event_id=${event.event_id}`);
  log(`payload_hash=${event.payload_hash}`);

  const store = createMemoryCheckpointStore();
  await store.set('demo', 'people', { token: event.checkpoint });
  const got = await store.get('demo', 'people');
  log(`checkpoint=${got?.token ?? ''}`);
  log('ok');
  return 0;
}

export async function runWritebackDemo(
  log: (message: string) => void = console.log,
): Promise<number> {
  const mappings = [
    { sourceField: 'order_status', propertyTypeId: 'status' as const },
    { sourceField: 'amt', propertyTypeId: 'amount' as const, transform: 'number' as const },
  ];
  const src = createMemoryWriteBackConnector({
    records: { 'SO-1': { order_status: 'pending', amt: 150 } },
  });

  log('== 1. observe fonte ==');
  const observed = sourceFieldsToProperties(src.getRecord('SO-1') ?? {}, mappings);
  log(`  SO-1 status=${String(observed.status)} amount=${String(observed.amount)}`);

  log('== 2. act (object properties) + writeBack ==');
  const decided = { ...observed, status: 'approved' };
  const fields = propertiesToSourceFields(decided, mappings);
  const wb = await src.writeBack!({
    object: { sourceSystem: 'ext', objectName: 'orders' },
    primaryKey: 'SO-1',
    operation: 'update_order_status',
    fields,
    idempotencyKey: 'neumann:demo-1',
  });
  log(`  source.order_status=${String(wb.record?.order_status)}`);

  log('== 3. connector detecta → ontology converge ==');
  const events = [];
  for await (const ev of src.snapshot({ sourceSystem: 'ext', objectName: 'orders' })) {
    events.push(ev);
  }
  const converged = sourceFieldsToProperties(src.getRecord('SO-1') ?? {}, mappings);
  log(`  snapshot=${events.length} object.status=${String(converged.status)}`);

  const ok =
    observed.status === 'pending' &&
    wb.ok &&
    wb.record?.order_status === 'approved' &&
    converged.status === 'approved' &&
    events.some((e) => e.payload.order_status === 'approved');

  log(ok ? 'demo ok — write-back: fonte muda e o objeto converge' : 'demo FAIL');
  return ok ? 0 : 1;
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
  if (cmd === 'demo') return runDemo(log);
  if (cmd === 'writeback') return runWritebackDemo(log);
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
