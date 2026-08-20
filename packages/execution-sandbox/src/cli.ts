#!/usr/bin/env node
/**
 * execution-sandbox — src/cli.ts
 * demo: run ok + escapes (FS/network/timeout) bloqueados com audit.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createExecutionSandbox } from './core/sandbox.js';

const USAGE = `execution-sandbox (sandbox/sbx) — PASSO 14: sandbox + audit
  US20250265045A1

Uso:
  sandbox demo
  sbx demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const sbx = createExecutionSandbox({
    clock: createDeterministicClock('2024-01-01T00:00:00.000Z'),
    nextId: createIdGenerator(),
    policy: {
      maxCpuMs: 10,
      maxMemoryBytes: 8_000,
      fsAllowPrefixes: ['tmp/'],
      allowNetwork: false,
      maxOutputBytes: 4_000,
    },
  });

  sbx.registerIdentity({
    subjectId: 'user-1',
    displayName: 'Pipeline Runner',
    roles: ['transform:run'],
  });
  sbx.seedFile('tmp/input.txt', 'hello');

  sbx.registerTransform('safe-map', (input, host) => {
    host.tick(2);
    const rows = input as { v: number }[];
    return rows.map((r) => ({ v: r.v * 2 }));
  });

  sbx.registerTransform('escape-fs', (_input, host) => {
    host.readFile('../../etc/passwd');
    return null;
  });

  sbx.registerTransform('escape-net', (_input, host) => {
    host.fetch('https://evil.example');
    return null;
  });

  sbx.registerTransform('escape-cpu', (_input, host) => {
    host.tick(100);
    return null;
  });

  log('== 1. safe run ==');
  const ok = sbx.run({
    identityId: 'user-1',
    transformId: 'safe-map',
    input: [{ v: 1 }, { v: 2 }],
  });
  log(`  ok=${String(ok.ok)} output=${JSON.stringify(ok.output)} audit=${ok.auditId}`);

  log('== 2. escape attempts (must deny) ==');
  const fs = sbx.run({
    identityId: 'user-1',
    transformId: 'escape-fs',
    input: {},
  });
  log(`  FS_ESCAPE denied=${String(!fs.ok)} reason=${String(fs.deniedReason)}`);

  const net = sbx.run({
    identityId: 'user-1',
    transformId: 'escape-net',
    input: {},
  });
  log(`  NETWORK_DENIED denied=${String(!net.ok)} reason=${String(net.deniedReason)}`);

  const cpu = sbx.run({
    identityId: 'user-1',
    transformId: 'escape-cpu',
    input: {},
  });
  log(`  TIMEOUT denied=${String(!cpu.ok)} reason=${String(cpu.deniedReason)}`);

  const anon = sbx.run({
    identityId: 'ghost',
    transformId: 'safe-map',
    input: [],
  });
  log(`  IDENTITY_REQUIRED denied=${String(!anon.ok)} reason=${String(anon.deniedReason)}`);

  log('== 3. audit ==');
  const events = sbx.auditLog();
  for (const e of events) {
    log(
      `  ${e.id} ok=${String(e.ok)} transform=${e.transformId}` +
        (e.deniedReason ? ` deny=${e.deniedReason}` : ''),
    );
  }

  const passed =
    ok.ok === true &&
    fs.deniedReason === 'FS_ESCAPE' &&
    net.deniedReason === 'NETWORK_DENIED' &&
    cpu.deniedReason === 'TIMEOUT' &&
    anon.deniedReason === 'IDENTITY_REQUIRED' &&
    events.length >= 5;

  log(passed ? '== demo ok ==' : '== demo FAIL ==');
  return passed ? 0 : 1;
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
