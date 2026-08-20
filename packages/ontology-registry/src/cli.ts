#!/usr/bin/env node
/**
 * ontology-registry — src/cli.ts
 * demo: criar ObjectType → commit (v1) → evoluir → commit (v2) → rollback → v3=v1.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createOntologyRegistry } from './core/registry.js';

const USAGE = `ontology-registry (ontology / onto) — PASSO 17: Ontology Registry versionado
  US 7,962,495 … US 10,872,067 / US20100070426 / US 9,229,966

Uso:
  onto demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export async function runDemo(log: (message: string) => void = console.log): Promise<number> {
  const reg = createOntologyRegistry({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });

  log('== 1. create ontology + SEMÂNTICA (Property/Object/Link) ==');
  const onto = await reg.createOntology({
    name: 'kernel-demo',
    description: 'generic dataset ontology',
    createdBy: 'platform',
  });
  await reg.addPropertyType(onto.id, {
    id: 'pt.name',
    displayName: 'Name',
    baseType: 'string',
    validators: [{ kind: 'required' }],
  });
  await reg.addPropertyType(onto.id, {
    id: 'pt.email',
    displayName: 'Email',
    baseType: 'string',
    validators: [{ kind: 'regex', pattern: '^[^@]+@[^@]+$' }],
  });
  await reg.addObjectType(onto.id, {
    id: 'ot.customer',
    displayName: 'Customer',
    baseType: 'ot.entity',
    propertyTypeIds: ['pt.name', 'pt.email'],
  });
  await reg.addLinkType(onto.id, {
    id: 'lt.customer_of',
    displayName: 'customer_of',
    sourceObjectTypeId: 'ot.customer',
    targetObjectTypeId: 'ot.customer',
    cardinality: 'N:N',
  });

  log('== 2. CINÉTICA (Action/Function stubs) ==');
  await reg.addActionType(onto.id, {
    id: 'act.reclassify',
    displayName: 'ReclassifyCustomer',
    inputObjectTypeIds: ['ot.customer'],
  });
  await reg.addFunctionType(onto.id, {
    id: 'fn.score',
    displayName: 'scoreRecord',
    inputObjectTypeIds: ['ot.customer'],
  });

  log('== 3. commit v1 ==');
  const v1 = await reg.commit({ ontologyId: onto.id, createdBy: 'platform' });
  log(`  v1=${v1.id} n=${v1.versionNumber} hash=${v1.contentHash.slice(0, 12)}…`);
  log(`  objectTypes=${Object.keys(v1.objectTypes).join(',')}`);

  log('== 4. evoluir draft → commit v2 ==');
  await reg.openDraft(onto.id);
  await reg.addPropertyType(onto.id, {
    id: 'pt.region',
    displayName: 'Region',
    baseType: 'string',
  });
  // ObjectType mutável só no draft: re-add via openDraft already has ot.customer —
  // replace by adding new type Account.
  await reg.addObjectType(onto.id, {
    id: 'ot.account',
    displayName: 'Account',
    propertyTypeIds: ['pt.name', 'pt.region'],
  });
  const v2 = await reg.commit({ ontologyId: onto.id, createdBy: 'platform' });
  log(`  v2=${v2.id} n=${v2.versionNumber} hash=${v2.contentHash.slice(0, 12)}…`);
  const d = await reg.diff(v1.id, v2.id);
  log(`  diff added OT=${d.addedObjectTypes.join(',')} PT=${d.addedPropertyTypes.join(',')}`);

  log('== 5. rollback → v3 conteúdo = v1 (histórico preservado) ==');
  const v3 = await reg.rollback(onto.id, v1.id, 'platform');
  log(`  v3=${v3.id} n=${v3.versionNumber} hash=${v3.contentHash.slice(0, 12)}…`);
  const versions = await reg.listVersions(onto.id);
  log(`  versions=${versions.map((v) => `v${v.versionNumber}`).join(',')}`);

  // Imutabilidade: tentar mutar snapshot deve falhar (frozen).
  let frozen = false;
  try {
    (v1.objectTypes as Record<string, unknown>)['hack'] = {};
  } catch {
    frozen = true;
  }
  // Em engines sem throw em freeze assign, verifica ausência.
  if (!frozen) frozen = !('hack' in v1.objectTypes);

  const ok =
    v1.versionNumber === 1 &&
    v2.versionNumber === 2 &&
    v3.versionNumber === 3 &&
    v3.contentHash === v1.contentHash &&
    v3.contentHash !== v2.contentHash &&
    versions.length === 3 &&
    d.addedObjectTypes.includes('ot.account') &&
    !v3.objectTypes['ot.account'] &&
    !!v3.objectTypes['ot.customer'] &&
    !!v3.actionTypes['act.reclassify'] &&
    frozen;

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
