#!/usr/bin/env node
/**
 * object-platform — src/cli.ts
 * demo: mapping v1 → project → query/get/history/provenance → user_edit vence source → authz deny.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AuthorizeFn } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createObjectPlatform } from './core/platform.js';

const USAGE = `object-platform (objects / obj) — PASSO 18: mapping + projetor + Object API
  US 8,930,897 / US 10,691,729 / EP3425537A1 / US 11,816,156 / US 12,561,339

Uso:
  obj demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export async function runDemo(log: (message: string) => void = console.log): Promise<number> {
  const denied = new Set<string>(['object:secret-denied']);
  const authorize: AuthorizeFn = (req) => {
    if (req.operation === 'read' && denied.has(req.resource)) {
      return {
        decision: 'deny',
        principalEpids: [],
        resourceEpid: null,
        reason: 'demo deny',
      };
    }
    return {
      decision: 'allow',
      principalEpids: ['epid-demo'],
      resourceEpid: null,
      reason: 'demo allow',
    };
  };

  const platform = createObjectPlatform({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
    authorize,
  });

  log('== 1. mapping versionado dataset→ObjectType ==');
  const mapping = platform.createMapping({
    name: 'customers-from-crm',
    datasetId: 'ds-crm',
    objectTypeId: 'ot.customer',
    ontologyVersionId: 'ov-1',
    primaryKeyFields: ['id'],
    propertyMappings: [
      { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' },
      { sourceField: 'email', propertyTypeId: 'pt.email', transform: 'string' },
    ],
    linkMappings: [
      {
        linkTypeId: 'lt.customer_of',
        sourceField: 'parent_id',
        targetObjectTypeId: 'ot.customer',
      },
    ],
    createdBy: 'platform',
  });
  const mv1 = platform.getLatestMappingVersion(mapping.id)!;
  log(`  mapping=${mapping.id} mv1=${mv1.id} hash=${mv1.contentHash.slice(0, 12)}…`);

  log('== 2. evoluir mapping → v2 ==');
  const draft = platform.openMappingDraft(mapping.id);
  draft.propertyMappings.push({
    sourceField: 'region',
    propertyTypeId: 'pt.region',
    transform: 'string',
  });
  platform.setMappingDraft(mapping.id, {
    ontologyVersionId: draft.ontologyVersionId,
    objectTypeId: draft.objectTypeId,
    primaryKeyFields: draft.primaryKeyFields,
    propertyMappings: draft.propertyMappings,
    linkMappings: draft.linkMappings,
  });
  const mv2 = platform.commitMapping({ mappingId: mapping.id, createdBy: 'platform' });
  log(`  mv2=${mv2.id} n=${mv2.versionNumber} props=${mv2.propertyMappings.length}`);

  log('== 3. projetor (dataset version → objects + history + provenance) ==');
  const proj = await platform.project({
    mappingVersionId: mv2.id,
    datasetVersionId: 'dv-1',
    rows: [
      { fields: { id: 'C1', name: 'Ada', email: 'ada@ex.com', region: 'EU', parent_id: '' } },
      { fields: { id: 'C2', name: 'Bob', email: 'bob@ex.com', region: 'US', parent_id: 'C1' } },
    ],
  });
  log(`  upserted=${proj.upserted} links=${proj.linksUpserted} ids=${proj.objectIds.join(',')}`);

  log('== 4. Object API (via authorize) ==');
  const principal = 'alice';
  const listed = await platform.queryObjects(principal, { objectTypeId: 'ot.customer' });
  const ada = listed.find((o) => o.primaryKey === 'C1')!;
  const bob = listed.find((o) => o.primaryKey === 'C2')!;
  const got = await platform.getObject(principal, ada.id);
  const hist = await platform.getHistory(principal, ada.id);
  const prov = await platform.getProvenance(principal, ada.id);
  const around = await platform.traverseLinks(principal, bob.id, 'lt.customer_of');
  log(`  query=${listed.length} get=${got?.properties['pt.name']} hist=${hist?.length}`);
  log(`  provenance ds=${prov?.datasetVersionId} map=${prov?.mappingVersionId}`);
  log(`  traverseLinks bob→${around.map((o) => o.primaryKey).join(',') || '(none)'}`);

  log('== 5. user_edit vence data_source ==');
  await platform.applyUserEdit(ada.id, { 'pt.name': 'Ada Lovelace' }, principal);
  await platform.project({
    mappingVersionId: mv2.id,
    datasetVersionId: 'dv-2',
    rows: [
      { fields: { id: 'C1', name: 'SHOULD_NOT_APPLY', email: 'ada@ex.com', region: 'EU', parent_id: '' } },
      { fields: { id: 'C2', name: 'Bob', email: 'bob@ex.com', region: 'US', parent_id: 'C1' } },
    ],
  });
  const after = (await platform.getObject(principal, ada.id))!;
  log(`  name after reproject=${String(after.properties['pt.name'])}`);

  log('== 6. authorize deny esconde objeto ==');
  // Força resource id fixo só para o gate deny — usa id real se já estiver na deny list.
  // Demo: negar leitura do bob via set local (authorize checa object:id).
  denied.add(`object:_/${encodeURIComponent(bob.id)}`);
  const hidden = await platform.getObject(principal, bob.id);
  const stillAda = await platform.getObject(principal, ada.id);
  log(`  bob hidden=${hidden === null} ada visible=${stillAda !== null}`);

  const ok =
    mv1.versionNumber === 1 &&
    mv2.versionNumber === 2 &&
    proj.upserted === 2 &&
    proj.linksUpserted === 1 &&
    listed.length === 2 &&
    got?.properties['pt.name'] === 'Ada' &&
    (hist?.length ?? 0) >= 1 &&
    prov?.datasetId === 'ds-crm' &&
    around[0]?.primaryKey === 'C1' &&
    after.properties['pt.name'] === 'Ada Lovelace' &&
    after.createdOrEditedByUser === true &&
    hidden === null &&
    stillAda !== null;

  log(ok ? 'demo ok' : 'demo FAIL');
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
  if (cmd === 'demo') return await runDemo(log);
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

/**
 * Process entry. WHY a named function and not top-level await: this module is
 * also loaded through a CJS interop path, where top-level await cannot be
 * transformed. A rejection here is fatal by design — the CLI must not exit 0.
 */
export async function runMain(argv: readonly string[]): Promise<void> {
  process.exitCode = await runCommandLine(argv);
}

if (isMain()) {
  void runMain(process.argv.slice(2));
}
