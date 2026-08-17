#!/usr/bin/env node
/**
 * offline-sync — src/cli.ts
 * demo: snapshot autorizado → disconnect → mutations → reconnect → conflitos → convergência.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statesConverged } from './core/converge.js';
import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import {
  createBaseInstallation,
  createDisconnectedInstallation,
} from './core/investigation.js';
import { createNetwork } from './core/network.js';
import { createReplica } from './core/replica.js';

const USAGE = `offline-sync (offline) — PASSO 34: offline + conflitos
  US 8,515,912 / US 9,569,070 / US 8,364,642 / US 8,812,444 / US 9,275,069

  Gate: rede estabilizou → authorized_state(A) == authorized_state(B)
  na porção compartilhável (partition + reorder + duplicate + drop + 3+ réplicas).

Uso:
  offline demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const nextId = createIdGenerator();
  const clock = createDeterministicClock();
  const A = createReplica({ id: 'A', nextId, clock });
  const B = createReplica({ id: 'B', nextId, clock });
  const C = createReplica({ id: 'C', nextId, clock });
  const net = createNetwork([A, B, C]);

  A.upsertObject({
    id: 'person-1',
    objectType: 'Person',
    title: 'Ada',
    properties: { city: 'London' },
    aclPrincipals: ['alice', 'bob'],
  });
  A.upsertObject({
    id: 'secret-1',
    objectType: 'Note',
    title: 'classified',
    properties: { body: 'alice-only' },
    aclPrincipals: ['alice'],
  });
  net.stabilize();

  // drop + reorder + duplicate
  const paris = A.patchObject('person-1', { properties: { city: 'Paris' } });
  const berlin = A.patchObject('person-1', { properties: { city: 'Berlin' } });
  net.deliver('A', 'B', { dropIds: [paris.id] });
  net.deliver('A', 'C', { reverse: true, duplicate: true });
  net.stabilize();
  const afterFaults = statesConverged([A, B, C], 'bob') && A.getObject('person-1')?.properties['city'] === 'Berlin';

  // partition + concurrent titles
  net.partition('A', 'B');
  A.patchObject('person-1', { title: 'Ada Lovelace' });
  B.patchObject('person-1', { title: 'A. Lovelace' });
  net.heal('A', 'B');
  net.stabilize();
  const pending = A.pendingConflicts();
  if (pending.length > 0) {
    A.resolveAll(
      pending.map((c) => c.id),
      { action: 'acceptLocal' },
    );
  }
  net.stabilize();
  const afterPartition = statesConverged([A, B, C], 'bob') && A.getObject('person-1')?.title === 'Ada Lovelace';

  // snapshot autorizado → disconnect → mutations → reconnect
  const laptop = A.cloneAuthorized({ replicaId: 'laptop', principal: 'bob' });
  net.attach(laptop);
  const hasSecretOnLaptop = laptop.getObject('secret-1') !== undefined;
  laptop.patchObject('person-1', { properties: { city: 'Lisbon' } });
  A.patchObject('person-1', { properties: { city: 'Vienna' } });
  net.stabilizeAuthorized('laptop', 'bob');
  if (A.pendingConflicts().length > 0) {
    A.resolveAll(
      A.pendingConflicts().map((c) => c.id),
      { action: 'acceptLocal' },
    );
  }
  net.stabilizeAuthorized('laptop', 'bob');
  if (laptop.pendingConflicts().length > 0) {
    laptop.resolveAll(
      laptop.pendingConflicts().map((c) => c.id),
      { action: 'acceptPeer' },
    );
  }
  net.stabilizeAuthorized('laptop', 'bob');
  const afterOffline =
    statesConverged([A, B, C, laptop], 'bob') &&
    !hasSecretOnLaptop &&
    A.getObject('secret-1') !== undefined &&
    laptop.getObject('secret-1') === undefined;

  const bobA = A.authorizedState('bob');
  const bobB = B.authorizedState('bob');
  log(`authorized_state A(bob)=${bobA.slice(0, 80)}…`);
  log(`authorized_state B(bob) equal=${bobA === bobB}`);

  // investigação desconectada claim 7
  const hub = createBaseInstallation({ replica: A, nextId });
  const inv = hub.createInvestigation({
    name: 'shareable-people',
    principal: 'bob',
    objectIds: ['person-1', 'secret-1'],
  });
  const initialBase = hub.generateBaseFile(inv.id, ['person-1']);
  const disc = createDisconnectedInstallation({ nextId });
  disc.loadBaseFile(initialBase);
  const secretInBase = initialBase.objects.some((o) => o.id === 'secret-1');
  A.upsertObject({
    id: 'person-2',
    objectType: 'Person',
    title: 'Bob',
    properties: { city: 'Porto' },
    aclPrincipals: ['alice', 'bob'],
  });
  const updateBase = hub.generateBaseFile(inv.id, ['person-1', 'person-2']);
  disc.loadBaseFile(updateBase);
  net.stabilizeAuthorized('laptop', 'bob');
  const claim7 =
    !secretInBase &&
    disc.replica.getObject('person-2')?.title === 'Bob' &&
    statesConverged([A, B, C], 'bob');

  log(`faults=${afterFaults} partition=${afterPartition} offline=${afterOffline} claim7=${claim7}`);

  const ok = afterFaults && afterPartition && afterOffline && claim7 && bobA === bobB;
  log(ok ? '== demo ok (convergência, sem GUI) ==' : '== demo FAIL ==');
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
