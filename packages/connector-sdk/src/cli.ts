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

const USAGE = `connector-sdk — helpers de Connector (Passo 5)

Uso:
  connector-sdk demo
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
