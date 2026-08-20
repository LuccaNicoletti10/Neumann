/**
 * ingestion-runtime — tests/harness.ts
 * Memory ProjectionWriter + mapping catalog. No company types.
 */
import type { AuthorizeFn, AuthorizeResult } from 'contracts';
import { createMemoryCheckpointStore } from 'connector-sdk';
import { createOntologyRegistry } from 'ontology-registry';
import {
  createDeterministicClock,
  createGovernedObjectRepository,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectHistoryStore,
  createMemoryObjectRepository,
  createMemoryProjectionLedger,
  createObjectPlatform,
  createOntologyVersionPolicy,
  createProjectionWriter,
  createSnapshotUnitOfWork,
} from 'object-platform';

import {
  catalogFromPlatform,
  createConnectorRegistry,
  createIngestionRuntime,
  createMemoryIngestionStore,
  createMemorySecretResolver,
  type EnvelopeSource,
  type SecretResolver,
} from '../src/index.js';

export const allow: AuthorizeFn = (): AuthorizeResult => ({
  decision: 'allow',
  principalEpids: ['p'],
  resourceEpid: 'admin:ingest',
  reason: 'ok',
});

export const deny: AuthorizeFn = (): AuthorizeResult => ({
  decision: 'deny',
  principalEpids: [],
  resourceEpid: null,
  reason: 'no',
});

export async function makeHarness(input: {
  sources?: EnvelopeSource[];
  secrets?: SecretResolver;
  authorize?: AuthorizeFn;
  projections?: ReturnType<typeof createProjectionWriter>;
} = {}) {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const ontology = createOntologyRegistry({ clock, nextId });
  const o = await ontology.createOntology({ name: 'ing' });
  await ontology.addPropertyType(o.id, { id: 'pt.code', displayName: 'Code', baseType: 'string' });
  await ontology.addPropertyType(o.id, { id: 'pt.name', displayName: 'Name', baseType: 'string' });
  await ontology.addObjectType(o.id, {
    id: 'ot.item',
    displayName: 'Item',
    propertyTypeIds: ['pt.code', 'pt.name'],
  });
  const v1 = await ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  const versionPolicy = createOntologyVersionPolicy({ registry: ontology });
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  const raw = createMemoryObjectRepository({ clock, nextId });
  const objects = createGovernedObjectRepository({
    inner: raw,
    versionPolicy,
    history,
    principal: () => 'svc',
    mode: 'enforce',
  });
  const links = createMemoryLinkRepository({
    clock,
    nextId,
    objectExists: async (oid, t, pk) => Boolean(await objects.get(oid, t, pk)),
  });
  const events = {
    rows: [] as unknown[],
    async append(event: { kind: string; ontologyId: string; principal: string }) {
      const rec = { id: `evt-${this.rows.length + 1}`, ...event };
      this.rows.push(rec);
      return rec;
    },
    async list() {
      return this.rows;
    },
    capture() {
      return [...this.rows];
    },
    restore(s: unknown) {
      this.rows.length = 0;
      this.rows.push(...(s as unknown[]));
    },
  };
  const ledger = createMemoryProjectionLedger();
  const writer =
    input.projections ??
    createProjectionWriter({
      objects,
      links,
      events: events as never,
      ledger,
      ontology,
      versionPolicy,
      authorize: input.authorize ?? allow,
      resourceId: 'admin:projection',
      unitOfWork: createSnapshotUnitOfWork([raw, links, history, ledger], () => ({
        objects,
        links,
        events: events as never,
        ledger,
      })),
      clock,
    });
  const platform = createObjectPlatform({
    clock,
    nextId,
    objects,
    links,
    history,
    ontologyId: o.id,
    authorize: input.authorize ?? allow,
  });
  const mapping = platform.createMapping({
    name: 'items',
    datasetId: 'ds',
    objectTypeId: 'ot.item',
    ontologyVersionId: v1.id,
    primaryKeyFields: ['id'],
    propertyMappings: [
      { sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' },
      { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' },
    ],
    createdBy: 'test',
  });
  const secrets = input.secrets ?? createMemorySecretResolver();
  const store = createMemoryIngestionStore();
  const runtime = createIngestionRuntime({
    projections: writer,
    catalog: catalogFromPlatform(platform),
    connectors: createConnectorRegistry(input.sources ?? []),
    store,
    checkpoints: createMemoryCheckpointStore(),
    authorize: input.authorize ?? allow,
    resourceId: 'admin:ingest',
    clock,
    nextId,
    secrets,
  });
  return {
    runtime,
    objects,
    ontology,
    platform,
    mapping,
    ontologyId: o.id,
    v1,
    clock,
    nextId,
    writer,
    store,
  };
}
