#!/usr/bin/env node
/**
 * contracts — src/cli.ts
 * demo: golden CanonicalEvent + hash estável.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  assertCanonicalEvent,
  hashPayload,
  serializeCanonicalEvent,
  type CanonicalEvent,
} from './v1/canonical-event.js';

const USAGE = `contracts — CanonicalEvent + Connector API (v1)

Uso:
  contracts demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const GOLDEN_PAYLOAD: Record<string, unknown> = {
  email: 'ada@example.com',
  id: 1,
  name: 'Ada Lovelace',
};

export function buildGoldenEvent(): CanonicalEvent {
  const payload_hash = hashPayload(GOLDEN_PAYLOAD);
  return {
    event_id: 'evt-1',
    source_system: 'crm',
    source_object: 'people',
    source_primary_key: '1',
    schema_version: '1',
    occurred_at: '2024-01-01T00:00:00.000Z',
    ingested_at: '2024-01-01T00:00:01.000Z',
    connector_id: 'pg-crm',
    checkpoint: 'snap:people:1',
    principal: 'sa:ingest',
    policy_tags: ['pii.email'],
    payload_hash,
    payload: GOLDEN_PAYLOAD,
  };
}

function runDemo(log: (message: string) => void): number {
  const event = buildGoldenEvent();
  assertCanonicalEvent(event);
  const json = serializeCanonicalEvent(event);
  log('== CanonicalEvent golden ==');
  log(json);
  log(`payload_hash=${event.payload_hash}`);
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
