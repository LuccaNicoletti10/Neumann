#!/usr/bin/env node
/**
 * policy-engine — src/cli.ts
 * demo: EPID + authorize + secured read (sem count) + audit tamper detection.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createDeterministicClock,
  createDeterministicSalt,
  createIdGenerator,
} from './core/determinism.js';
import { createAuditLog } from './core/audit.js';
import { createPolicyEngine } from './core/engine.js';

const USAGE = `policy-engine (policy / authz) — PASSO 16: authorize + audit hash-chained
  US 10,432,469 / US 10,397,229 / US20150188715

Uso:
  policy demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock('2024-06-01T12:00:00.000Z');
  const ids = createIdGenerator();
  const engine = createPolicyEngine({ clock, nextId: ids });
  const audit = createAuditLog({
    clock,
    nextId: createIdGenerator(),
    nextSalt: createDeterministicSalt(),
  });

  log('== 1. grants + node graph (EPID) ==');
  engine.grantPolicy('alice', 'finance');
  engine.grantPolicy('bob', 'ops');

  const root = engine.addNode({
    id: 'node-root',
    resourceId: 'org',
    policy: 'finance',
    parentId: null,
  });
  const sales = engine.addNode({
    id: 'node-sales',
    resourceId: 'ds-sales',
    policy: 'finance',
    parentId: root.id,
  });
  const secret = engine.addNode({
    id: 'node-secret',
    resourceId: 'ds-secret',
    policy: 'ops',
    parentId: root.id,
  });
  log(`  sales epid=${sales.epid} secret epid=${secret.epid}`);

  log('== 2. authorize allow/deny ==');
  const aliceRead = engine.authorize({
    principal: 'alice',
    resource: 'ds-sales',
    operation: 'read',
  });
  const bobReadSales = engine.authorize({
    principal: 'bob',
    resource: 'ds-sales',
    operation: 'read',
  });
  log(`  alice→sales read=${aliceRead.decision}`);
  log(`  bob→sales read=${bobReadSales.decision}`);
  audit.append(`authorize ${aliceRead.decision} read ds-sales`, {
    decision: aliceRead.decision,
  }, 'alice');
  audit.append(`authorize ${bobReadSales.decision} read ds-sales`, {
    decision: bobReadSales.decision,
  }, 'bob');

  log('== 3. security matrix ==');
  const matrix = engine.securityMatrix('bob', 'ds-sales');
  const readCell = matrix.cells.find((c) => c.operation === 'read');
  log(
    `  bob/ds-sales read=${readCell?.decision} hideExistence=${readCell?.hideExistence}`,
  );

  log('== 4. secured read — sem permissão não vê objeto NEM count ==');
  const universe = [
    { resourceId: 'ds-sales', name: 'sales' },
    { resourceId: 'ds-secret', name: 'secret' },
  ];
  const bobView = engine.securedRead('bob', universe);
  const aliceView = engine.securedRead('alice', universe);
  log(`  bob items=${bobView.items.map((i) => i.name).join(',') || '(none)'} count=${bobView.count}`);
  log(
    `  alice items=${aliceView.items.map((i) => i.name).join(',')} count=${aliceView.count}`,
  );

  const bobOnlySecret = engine.securedRead('bob', [
    { resourceId: 'ds-sales', name: 'sales' },
  ]);
  log(`  bob on sales-only → count=${bobOnlySecret.count} (null=hidden)`);

  log('== 5. create resource admissions ==');
  const created = engine.createResource('alice', {
    resourceId: 'ds-ledger',
    resourceType: 'dataset',
    parentId: root.id,
    policy: 'finance',
  });
  const deniedCreate = engine.createResource('bob', {
    resourceId: 'ds-hack',
    resourceType: 'dataset',
    parentId: root.id,
    policy: 'finance',
  });
  log(`  alice create ledger ok=${created.ok} epid=${created.epid}`);
  log(`  bob create finance ok=${deniedCreate.ok} reason=${deniedCreate.denyReason}`);
  audit.append(`create ds-ledger ${created.ok}`, { op: 'create' }, 'alice');
  audit.commit('demo-seal');

  log('== 6. audit verify + tamper detection ==');
  const okVerify = audit.verify();
  log(`  verify ok=${okVerify.ok} checked=${okVerify.checked}`);

  const mutated = audit.list().map((e, i) =>
    i === 1 ? { ...e, summaryHash: '0'.repeat(64) } : e,
  );
  const tamper = audit.detectTamper(mutated);
  log(`  tamper detected ok=${tamper.ok} reason=${tamper.reason}`);

  const redacted = audit.redact(audit.list()[1]!.id);
  const afterRedact = audit.verify();
  log(`  redact ${redacted.id} type=${redacted.messageType} chainStillOk=${afterRedact.ok}`);

  const ok =
    aliceRead.decision === 'allow' &&
    bobReadSales.decision === 'deny' &&
    bobView.items.every((i) => i.resourceId === 'ds-secret') &&
    bobOnlySecret.count === null &&
    bobOnlySecret.items.length === 0 &&
    aliceView.count === 1 &&
    created.ok &&
    !deniedCreate.ok &&
    okVerify.ok &&
    !tamper.ok &&
    afterRedact.ok;

  log(ok ? '== demo ok ==' : '== demo FAIL ==');
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
