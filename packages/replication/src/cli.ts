#!/usr/bin/env node
/**
 * replication — src/cli.ts
 * demo: mutation + filtro ACL + mudança redigida + checkpoint + chunks.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SECRET } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createExportingSystem, createImportingSystem } from './core/incremental.js';
import { createOntologyMap, mapsCompatible, propertyRoundTripStable } from './core/ontology-map.js';
import { createReplicationSite, replicate } from './core/site.js';

const USAGE = `replication (repl) — PASSO 33: protocolo de replicação cross-ACL
  US 8,886,601 / 9,785,694 / 9,330,157 / 10,061,828 / 8,527,461 / 8,838,538

  Gate: réplica sem permissão converge mesmo recebendo mudança redigida.

Uso:
  repl demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const SSN = '800-88-8888';

export function runDemo(log: (message: string) => void = console.log): number {
  const nextId = createIdGenerator();
  const clock = createDeterministicClock();
  const A = createReplicationSite({ id: 'A', nextId, clock });
  const B = createReplicationSite({ id: 'B', nextId, clock });

  A.mutate({
    objectId: 'R101',
    unitId: 'Name',
    objectType: 'Person',
    payload: 'John Smith',
    acl: 'public',
  });
  A.mutate({
    objectId: 'R101',
    unitId: 'SSN',
    objectType: 'Person',
    payload: SSN,
    acl: 'private',
    classification: 'Secret',
  });

  const results = replicate(A, B, { allowedAcls: ['public'], maxClassificationRank: SECRET.rank });
  const nameOk = B.visibleValue('R101', 'Name') === 'John Smith';
  const ssnHidden = B.visibleValue('R101', 'SSN') === undefined;
  const ssnRedacted = B.getObject('R101')?.units['SSN']?.redacted === true;
  const leaked = JSON.stringify(B.getObject('R101'))?.includes(SSN) === true;
  const receivedRedacted = results.some((r) => r.status === 'applied');
  const ck = A.checkpoint('B');
  const checkpointMoved = Object.keys(ck.vector).length > 0;

  A.mutate({
    objectId: 'R101',
    unitId: 'Name',
    operation: 'acl',
    payload: null,
    acl: 'public',
  });
  replicate(A, B, { allowedAcls: ['public'] });
  const aclMutation = B.getObject('R101')?.units['Name']?.acl === 'public';

  const exporter = createExportingSystem(A, nextId);
  const importer = createImportingSystem(B);
  A.mutate({ objectId: 'R102', unitId: 'title', objectType: 'Person', payload: 'Ada', acl: 'public' });
  const plan = exporter.plan('B', { chunkSize: 1 });
  const chunks = exporter.execute(plan.planId, { allowedAcls: ['public'] });
  const chunked = chunks.length >= 1 && importer.receiveChunk(chunks[0]!).duplicate === false;
  const dup = chunks[0] ? importer.receiveChunk(chunks[0]).duplicate : false;

  const mapA = createOntologyMap({
    systemIds: ['A', 'B'],
    objectMappings: { Person: 'Employee' },
    propertyMappings: { Name: 'displayName' },
    linkMappings: { ParentOf: 'ChildOf' },
    objectParentChild: { Agent: ['Person'] },
    linkParentChild: {},
    linkReverse: ['ParentOf'],
    droppedTypes: { A: ['InternalNote'] },
  });
  const mapB = createOntologyMap(mapA.spec);
  const ontologyOk = mapsCompatible(mapA, mapB) && mapA.digest().length === 64;
  const roundTrip = propertyRoundTripStable('42', 'string', 'number');

  log(`name=${nameOk} ssnHidden=${ssnHidden} redacted=${ssnRedacted} leaked=${leaked}`);
  log(`checkpoint=${checkpointMoved} aclMutation=${aclMutation} chunks=${chunked} dup=${dup}`);
  log(`ontologyDigest=${ontologyOk} roundTrip=${roundTrip} received=${receivedRedacted}`);

  const ok =
    nameOk &&
    ssnHidden &&
    ssnRedacted &&
    !leaked &&
    receivedRedacted &&
    checkpointMoved &&
    aclMutation &&
    chunked &&
    dup &&
    ontologyOk &&
    roundTrip;
  log(ok ? '== demo ok (cross-ACL, sem leak) ==' : '== demo FAIL ==');
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
