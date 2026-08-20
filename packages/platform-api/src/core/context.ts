/**
 * platform-api — src/core/context.ts
 * Explicit memory vs postgres platform wiring. Policy is always a ready PolicyRuntime.
 */

import {
  createActionExecutor,
  createFailureSurvivingExecutor,
  createMemoryActionExecutionStore,
  createMemoryOperationalEventStore,
  createMemoryOutboxRepository,
  createPgActionExecutionStore,
  createPgOperationalEventStore,
  type ActionUnitOfWork,
} from 'action-engine';
import type {
  ActionExecutionStore,
  ActionExecutor,
  ConnectorRegistrationRepository,
  EntityResolutionEngine,
  FunctionArtifactStore,
  FunctionRuntime,
  LinkReader,
  LinkRepository,
  MappingVersionRepository,
  ObjectPlatform,
  ObjectReader,
  ObjectRepository,
  OperationalEventStore,
  OntologyRegistry,
  OutboxReader,
  ProjectionWriter,
  SqlClient,
  TransactionManager,
} from 'contracts';
import { createPgOutboxRepository } from 'event-bus';
import { createEntityResolver } from 'entity-resolution';
import {
  createFunctionDefinitionResolver,
  createFunctionRuntime,
  createFunctionWorker,
  createMemoryFunctionArtifactStore,
  createMemoryFunctionExecutionStore,
  createPgFunctionArtifactStore,
  createPgFunctionExecutionStore,
  type FunctionWorker,
} from 'function-registry';
import {
  createDeterministicClock,
  createGovernedObjectRepository,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectHistoryStore,
  createMemoryObjectRepository,
  createMemoryProjectionLedger,
  createMemoryTransactionBoundary,
  createOntologyVersionPolicy,
  createPgLinkRepository,
  createPgObjectHistoryStore,
  createPgObjectRepository,
  createPgProjectionLedger,
  createPgSqlClient,
  createProjectionWriter,
  createSystemClock,
  createUuidIdGenerator,
  applyPlatformMigrations,
  createObjectPlatform,
  type Clock,
  type IdGenerator,
  type ObjectHistoryStore,
  type OntologyVersionPolicy,
  type ProjectionUnitOfWork,
} from 'object-platform';
import {
  catalogFromRepository,
  createDurableConnectorRegistry,
  createIngestionRuntime,
  createIngestionWorker,
  createMemoryCheckpointStore,
  createMemoryConnectorRegistrationRepository,
  createMemoryIngestionStore,
  createMemoryMappingVersionRepository,
  createMemorySecretResolver,
  createPgCheckpointStore,
  createPgConnectorRegistrationRepository,
  createPgIngestionStore,
  createPgMappingVersionRepository,
  sourceFromRegistration,
  type EnvelopeSource,
  type IngestionLogger,
  type IngestionRuntime,
  type IngestionWorker,
  type SecretResolver,
} from 'ingestion-runtime';
import { createGraphQueryEngine, type GraphQueryEngine } from 'knowledge-graph';
import { createOntologyRegistry, createPgOntologyRegistry } from 'ontology-registry';
import {
  ALLOW_ALL_POLICY_OVERLAY,
  createAllowAllTestPolicy,
  createDenyAllAuthorizer,
  createPgAuditRepository,
  createPgPolicyStore,
  createPolicyRuntime,
  createPolicyRuntimeFromOverlay,
  createAuditLog,
  createMemoryAuditRepository,
  DENY_ALL_POLICY_OVERLAY,
  ResourceIds,
  type PolicyAdmin,
  type PolicyOverlay,
  type PolicyRuntime,
} from 'policy-engine';

import { wrapOntologyWithPolicyCatalog, syncPolicyCatalog } from './ontology-policy-sync.js';
import { createFunctionObjectReader } from './function-reads.js';

import { getCurrentPrincipal, runWithPrincipal } from './principal.js';

export type PolicyFixtureName = 'allow-all' | 'deny-all';

export type { ObjectReader, LinkReader };

export interface PublicPlatformContext {
  mode: 'memory' | 'postgres';
  ontology: OntologyRegistry;
  objects: ObjectReader;
  links: LinkReader;
  graph: GraphQueryEngine;
  actions: ActionExecutor;
  events: OperationalEventStore;
  audit: ReturnType<typeof createAuditLog>;
  history: ObjectHistoryStore;
  er: EntityResolutionEngine;
  functions: FunctionRuntime;
  functionArtifacts: FunctionArtifactStore;
  functionWorker: FunctionWorker;
  policy: PolicyRuntime;
  /**
   * Same object as `policy` (ADR-0009). Not a second evaluator.
   */
  authorizer: PolicyRuntime;
  policyAdmin?: PolicyAdmin;
  ready: boolean;
  sql?: SqlClient;
  close?: () => Promise<void>;
}

export interface PlatformContext extends PublicPlatformContext {
  objects: ObjectRepository;
  links: LinkRepository;
  /** Ingestion port. Not mounted on /api/v2. */
  projections: ProjectionWriter;
  /** CLI/demo mapping Maps. Ingest catalog is `mappingVersions` (ADR-0017). */
  mappings: ObjectPlatform;
  mappingVersions: MappingVersionRepository;
  connectorRegistrations: ConnectorRegistrationRepository;
  /** Connector → Mapping pin → ProjectionWriter (ADR-0016). HTTP adapter is POST /api/v2/ingest/:connectorId. */
  ingestion: IngestionRuntime;
  ingestionWorker: IngestionWorker;
  /** Read side of the transactional outbox (ADR-0013). Not mounted on /api/v2. */
  outbox: OutboxReader;
  executions: ActionExecutionStore;
}

export interface CreateMemoryPlatformContextOptions {
  policy?: PolicyRuntime;
  /** @deprecated Fixture compiler output; same as `policy`. */
  authorizer?: PolicyRuntime;
  overlay?: PolicyOverlay;
  /** Named allow-all / deny-all. Required if policy/overlay/authorizer omitted. */
  policyFixture?: PolicyFixtureName;
  seed?: (ctx: PlatformContext) => void | Promise<void>;
  deterministic?: boolean;
  ingestionSources?: EnvelopeSource[];
  secrets?: SecretResolver;
  ingestionPageSize?: number;
  log?: IngestionLogger;
  /**
   * Test-only. Invoked after ProjectionWriter commit and before checkpoint.
   * Production must not set this.
   */
  afterProjectionBeforeCheckpoint?: () => Promise<void>;
  /**
   * Test-only. After Function-invoked Action commit and before Function result persist.
   */
  afterActionBeforeResult?: () => Promise<void>;
}

function fixtureOverlay(name: PolicyFixtureName): PolicyOverlay {
  return name === 'allow-all' ? ALLOW_ALL_POLICY_OVERLAY : DENY_ALL_POLICY_OVERLAY;
}

function resolveSyncPolicy(opts: CreateMemoryPlatformContextOptions): PolicyRuntime {
  if (opts.policy && opts.authorizer && opts.policy !== opts.authorizer) {
    throw new Error('second evaluator refused: authorizer must be the same PolicyRuntime as policy');
  }
  if (opts.policy) return opts.policy;
  if (opts.authorizer) return opts.authorizer;
  if (opts.overlay) return createPolicyRuntimeFromOverlay(opts.overlay);
  if (opts.policyFixture === 'allow-all') return createAllowAllTestPolicy();
  if (opts.policyFixture === 'deny-all') return createDenyAllAuthorizer();
  throw new Error(
    'createMemoryPlatformContext requires policy, overlay, or policyFixture (no implicit allow-all)',
  );
}

/**
 * Link cardinality comes from the pinned version, not from a fresh latest read.
 * WHY here: memory and postgres must ask the same authority the same way.
 */
async function cardinalityFromPolicy(
  versionPolicy: OntologyVersionPolicy,
  ontologyId: string,
  linkTypeId: string,
): Promise<'1:1' | '1:N' | 'N:1' | 'N:N' | undefined> {
  const pinned = await versionPolicy.pin({ kind: 'create', ontologyId });
  return pinned.version.linkTypes[linkTypeId]?.cardinality;
}

function bindPrincipalToWriter(inner: ProjectionWriter): ProjectionWriter {
  return {
    projectObject: (cmd) => runWithPrincipal(cmd.principal, () => inner.projectObject(cmd)),
    deleteProjectedObject: (cmd) =>
      runWithPrincipal(cmd.principal, () => inner.deleteProjectedObject(cmd)),
    projectLink: (cmd) => runWithPrincipal(cmd.principal, () => inner.projectLink(cmd)),
    deleteProjectedLink: (cmd) =>
      runWithPrincipal(cmd.principal, () => inner.deleteProjectedLink(cmd)),
    projectBatch: (cmd) => runWithPrincipal(cmd.principal, () => inner.projectBatch(cmd)),
    migrateObject: (cmd) => runWithPrincipal(cmd.principal, () => inner.migrateObject(cmd)),
  };
}

/** Test/demo context — memory adapters only. Policy must be explicit. */
export function createMemoryPlatformContext(
  opts: CreateMemoryPlatformContextOptions = {},
): PlatformContext {
  const policy = resolveSyncPolicy(opts);
  const deterministic = opts.deterministic !== false;
  const clock = deterministic ? createDeterministicClock() : createSystemClock();
  const nextId = deterministic ? createIdGenerator() : createUuidIdGenerator();
  const rawOntology = createOntologyRegistry({ clock, nextId });
  const ontology = wrapOntologyWithPolicyCatalog(rawOntology, () =>
    syncPolicyCatalog(rawOntology, policy),
  );
  const versionPolicy = createOntologyVersionPolicy({ registry: ontology });
  const rawObjects = createMemoryObjectRepository({ clock, nextId });
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  // WHY governed in memory too: the test double must reject the same writes and
  // record the same history as PostgreSQL, or a green memory suite proves nothing.
  const objects = createGovernedObjectRepository({
    inner: rawObjects,
    versionPolicy,
    history,
    principal: () => getCurrentPrincipal(),
    mode: 'enforce',
  });
  const links = createMemoryLinkRepository({
    clock,
    nextId,
    objectExists: async (ontologyId, objectTypeId, primaryKey) =>
      Boolean(await objects.get(ontologyId, objectTypeId, primaryKey)),
    cardinalityOf: async (ontologyId, linkTypeId) =>
      cardinalityFromPolicy(versionPolicy, ontologyId, linkTypeId),
  });
  const graph = createGraphQueryEngine({ objects, links });
  const auditRepository = createMemoryAuditRepository();
  const audit = createAuditLog({ clock, nextId, repository: auditRepository });
  const events = createMemoryOperationalEventStore({ clock, nextId });
  const executions = createMemoryActionExecutionStore();
  const outbox = createMemoryOutboxRepository();
  const ledger = createMemoryProjectionLedger();
  // WHY one boundary: objects, links, history, executions, events, audit, outbox
  // and the projection ledger roll back together, and every UnitOfWork derived
  // here serializes so a rollback cannot erase another transaction's commit.
  const boundary = createMemoryTransactionBoundary([
    rawObjects,
    links,
    history,
    executions,
    events,
    auditRepository,
    outbox,
    ledger,
  ]);
  const actionStores = { objects, links, events, executions, audit, outbox };
  const actionUow: ActionUnitOfWork = boundary.unitOfWork(() => actionStores);
  const innerActions = createActionExecutor({
    objects,
    links,
    audit,
    events,
    executions,
    outbox,
    ontology,
    authorize: policy.authorizeFn,
    policyGeneration: () => policy.generation(),
    mode: 'memory',
    unitOfWork: actionUow,
    clock,
    nextId,
  });
  const actions = createFailureSurvivingExecutor({
    inner: innerActions,
    rootExecutions: executions,
    clock,
  });
  const projections = bindPrincipalToWriter(
    createProjectionWriter({
      objects,
      links,
      events,
      ledger,
      audit,
      outbox,
      ontology,
      versionPolicy,
      authorize: policy.authorizeFn,
      resourceId: ResourceIds.admin('projection'),
      unitOfWork: boundary.unitOfWork(() => ({
        objects,
        links,
        events,
        ledger,
        audit,
        outbox,
      })),
      clock,
    }),
  );
  const mappings = createObjectPlatform({
    clock,
    nextId,
    objects,
    links,
    history,
    authorize: policy.authorizeFn,
  });
  const mappingVersions = createMemoryMappingVersionRepository({ clock, nextId });
  const connectorRegistrations = createMemoryConnectorRegistrationRepository();
  const ingestionStore = createMemoryIngestionStore();
  const ingestion = createIngestionRuntime({
    projections,
    catalog: catalogFromRepository(mappingVersions),
    connectors: createDurableConnectorRegistry({
      local: opts.ingestionSources ?? [],
      resolveRegistration: (id) => connectorRegistrations.get(id),
      sourceFactory: sourceFromRegistration,
    }),
    store: ingestionStore,
    checkpoints: createMemoryCheckpointStore(),
    authorize: policy.authorizeFn,
    resourceId: ResourceIds.admin('ingest'),
    clock,
    nextId,
    secrets: opts.secrets ?? createMemorySecretResolver(),
    registrations: connectorRegistrations,
    pageSize: opts.ingestionPageSize,
    log: opts.log,
    afterProjectionBeforeCheckpoint: opts.afterProjectionBeforeCheckpoint,
  });
  const ingestionWorker = createIngestionWorker({
    runtime: ingestion,
    store: ingestionStore,
    clock,
  });
  const er = createEntityResolver({ clock, nextId });
  const functionArtifacts = createMemoryFunctionArtifactStore({ clock });
  const functionExecutions = createMemoryFunctionExecutionStore();
  const functions = createFunctionRuntime({
    artifacts: functionArtifacts,
    executions: functionExecutions,
    resolver: createFunctionDefinitionResolver({ ontology }),
    ontology,
    authorize: policy.authorizeFn,
    reads: createFunctionObjectReader(policy, history),
    actions,
    policyGeneration: () => policy.generation(),
    clock,
    nextId,
    afterActionBeforeResult: opts.afterActionBeforeResult,
  });
  const functionWorker = createFunctionWorker({
    runtime: functions,
    executions: functionExecutions,
    clock,
    workerId: 'memory-fn',
  });

  const ctx: PlatformContext = {
    mode: 'memory',
    ontology,
    objects,
    links,
    graph,
    actions,
    events,
    audit,
    history,
    er,
    functions,
    functionArtifacts,
    functionWorker,
    policy,
    authorizer: policy,
    projections,
    mappings,
    mappingVersions,
    connectorRegistrations,
    ingestion,
    ingestionWorker,
    outbox,
    executions,
    ready: true,
  };
  if (opts.seed) {
    throw new Error('async seed requires createPlatformRuntime (must be awaited before listen)');
  }
  return ctx;
}

/**
 * @deprecated Use createMemoryPlatformContext for tests or createPostgresPlatformContext for runtime.
 */
export function createPlatformContext(
  opts: CreateMemoryPlatformContextOptions = {},
): PlatformContext {
  return createMemoryPlatformContext(opts);
}

export interface CreatePostgresPlatformContextOptions {
  sql?: SqlClient;
  transaction?: TransactionManager;
  databaseUrl?: string;
  policy?: PolicyRuntime;
  policyAdmin?: PolicyAdmin;
  /** @deprecated Same as `policy` — fixture compiler output. */
  authorizer?: PolicyRuntime;
  overlay?: PolicyOverlay;
  policyFixture?: PolicyFixtureName;
  /** enforce = reject undeclared writes; warn = log and allow. Default enforce. */
  governanceMode?: 'enforce' | 'warn';
  seed?: (ctx: PlatformContext) => void | Promise<void>;
  ingestionSources?: EnvelopeSource[];
  secrets?: SecretResolver;
  ingestionPageSize?: number;
  log?: IngestionLogger;
  /**
   * Test-only. Invoked after ProjectionWriter commit and before checkpoint.
   * Production must not set this.
   */
  afterProjectionBeforeCheckpoint?: () => Promise<void>;
  afterActionBeforeResult?: () => Promise<void>;
  clock?: Clock;
  nextId?: IdGenerator;
}

async function validatePolicySchema(sql: SqlClient): Promise<void> {
  try {
    await sql.query(`SELECT generation, overlay, catalog FROM policy_meta WHERE id = true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `policy schema missing (need 0010 + 0015 overlay + 0016 catalog); run pnpm db:migrate (${message})`,
    );
  }
}

/**
 * Durable production context. Fail-fast if sql/databaseUrl missing.
 * Awaits policy snapshot before returning. Does NOT fall back to memory.
 */
export async function createPostgresPlatformContext(
  opts: CreatePostgresPlatformContextOptions,
): Promise<PlatformContext> {
  const opened: Array<() => Promise<void>> = [];
  try {
    return await openPostgresPlatformContext(opts, opened);
  } catch (err) {
    for (const close of opened.reverse()) {
      await close().catch(() => undefined);
    }
    throw err;
  }
}

async function openPostgresPlatformContext(
  opts: CreatePostgresPlatformContextOptions,
  opened: Array<() => Promise<void>>,
): Promise<PlatformContext> {
  if (opts.policy && opts.authorizer && opts.policy !== opts.authorizer) {
    throw new Error('second evaluator refused: authorizer must be the same PolicyRuntime as policy');
  }

  let sql = opts.sql;
  let transaction = opts.transaction;
  let closeSql: (() => Promise<void>) | undefined;

  if (!sql) {
    const url = opts.databaseUrl ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'createPostgresPlatformContext requires sql client or DATABASE_URL',
      );
    }
    const client = createPgSqlClient({ connectionString: url });
    sql = client;
    transaction = client;
    closeSql = () => client.close();
    opened.push(() => client.close());
  }

  if (!transaction) {
    throw new Error(
      'createPostgresPlatformContext requires TransactionManager (pass transaction or databaseUrl)',
    );
  }

  await applyPlatformMigrations(sql);
  await validatePolicySchema(sql);

  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();
  const txManager = transaction;
  const rootSql = sql;
  const rawOntology = createPgOntologyRegistry({ sql: rootSql, clock, nextId });
  const policyHolder: { policy?: PolicyRuntime; admin?: PolicyAdmin } = {};
  const ontology = wrapOntologyWithPolicyCatalog(rawOntology, () => {
    if (!policyHolder.policy) return;
    return syncPolicyCatalog(rawOntology, policyHolder.policy, policyHolder.admin);
  });
  const governanceMode = opts.governanceMode ?? 'enforce';

  const versionPolicy = createOntologyVersionPolicy({ registry: ontology });

  function bind(client: SqlClient) {
    const rawObjects = createPgObjectRepository({ sql: client, clock, nextId });
    const history = createPgObjectHistoryStore({ sql: client, clock, nextId });
    const objects = createGovernedObjectRepository({
      inner: rawObjects,
      versionPolicy,
      history,
      principal: () => getCurrentPrincipal(),
      mode: governanceMode,
    });
    const links = createPgLinkRepository({
      sql: client,
      clock,
      nextId,
      objectExists: async (ontologyId, objectTypeId, primaryKey) =>
        Boolean(await objects.get(ontologyId, objectTypeId, primaryKey)),
      cardinalityOf: async (ontologyId, linkTypeId) =>
        cardinalityFromPolicy(versionPolicy, ontologyId, linkTypeId),
    });
    const events = createPgOperationalEventStore({ sql: client, clock, nextId });
    const executions = createPgActionExecutionStore({ sql: client });
    const audit = createAuditLog({
      clock,
      nextId,
      repository: createPgAuditRepository({ sql: client }),
    });
    const outbox = createPgOutboxRepository({ sql: client });
    const ledger = createPgProjectionLedger({ sql: client });
    return { objects, links, events, executions, audit, outbox, history, ledger };
  }

  const root = bind(rootSql);
  const graph = createGraphQueryEngine({ objects: root.objects, links: root.links });

  const unitOfWork: ActionUnitOfWork = {
    run: (fn) => txManager.transaction((tx) => fn(bind(tx))),
  };

  const standaloneAudit = createAuditLog({
    clock,
    nextId,
    repository: createPgAuditRepository({ sql: rootSql, transaction: txManager }),
  });

  const policyStore = createPgPolicyStore({ sql: rootSql, transaction: txManager });

  let policy = opts.policy ?? opts.authorizer;
  let policyAdmin = opts.policyAdmin;

  if (!policy) {
    const overlay =
      opts.overlay ?? (opts.policyFixture ? fixtureOverlay(opts.policyFixture) : undefined);
    const bundle = await createPolicyRuntime({
      store: policyStore,
      overlay,
      persistOverlayIfEmpty: overlay !== undefined,
      clock,
      nextId,
      onAudit: async (event, detail) => {
        await standaloneAudit.append(event, { generation: String(detail.generation ?? '') });
      },
    });
    policy = bundle.policy;
    policyAdmin = bundle.admin;
    opened.push(() => policy!.close());
  }

  policyHolder.policy = policy;
  policyHolder.admin = policyAdmin;
  await syncPolicyCatalog(rawOntology, policy, policyAdmin);

  const innerActions = createActionExecutor({
    objects: root.objects,
    links: root.links,
    audit: standaloneAudit,
    events: root.events,
    executions: root.executions,
    outbox: root.outbox,
    ontology,
    authorize: policy.authorizeFn,
    policyGeneration: () => policy.generation(),
    mode: 'production',
    unitOfWork,
    clock,
    nextId,
  });

  const actions = createFailureSurvivingExecutor({
    inner: innerActions,
    rootExecutions: root.executions,
    clock,
  });

  const projectionUow: ProjectionUnitOfWork = {
    run: (fn) =>
      txManager.transaction(async (tx) => {
        const b = bind(tx);
        return fn({
          objects: b.objects,
          links: b.links,
          events: b.events,
          ledger: b.ledger,
          audit: b.audit,
          outbox: b.outbox,
        });
      }),
  };

  const projections = bindPrincipalToWriter(
    createProjectionWriter({
      objects: root.objects,
      links: root.links,
      events: root.events,
      ledger: root.ledger,
      audit: standaloneAudit,
      outbox: root.outbox,
      ontology,
      versionPolicy,
      authorize: policy.authorizeFn,
      resourceId: ResourceIds.admin('projection'),
      unitOfWork: projectionUow,
      clock,
    }),
  );

  const mappings = createObjectPlatform({
    clock,
    nextId,
    objects: root.objects,
    links: root.links,
    history: root.history,
    authorize: policy.authorizeFn,
  });
  const mappingVersions = createPgMappingVersionRepository({ sql: rootSql, clock, nextId });
  const connectorRegistrations = createPgConnectorRegistrationRepository({ sql: rootSql });
  const ingestionStore = createPgIngestionStore({ sql: rootSql, transaction: txManager });
  const ingestion = createIngestionRuntime({
    projections,
    catalog: catalogFromRepository(mappingVersions),
    connectors: createDurableConnectorRegistry({
      local: opts.ingestionSources ?? [],
      resolveRegistration: (id) => connectorRegistrations.get(id),
      sourceFactory: sourceFromRegistration,
    }),
    store: ingestionStore,
    checkpoints: createPgCheckpointStore({ sql: rootSql }),
    authorize: policy.authorizeFn,
    resourceId: ResourceIds.admin('ingest'),
    clock,
    nextId,
    secrets: opts.secrets ?? createMemorySecretResolver(),
    registrations: connectorRegistrations,
    pageSize: opts.ingestionPageSize,
    log: opts.log,
    afterProjectionBeforeCheckpoint: opts.afterProjectionBeforeCheckpoint,
  });
  const ingestionWorker = createIngestionWorker({
    runtime: ingestion,
    store: ingestionStore,
    clock,
  });

  const er = createEntityResolver({ sql: rootSql, clock, nextId });
  const functionArtifacts = createPgFunctionArtifactStore({ sql: rootSql, clock });
  const functionExecutions = createPgFunctionExecutionStore({ sql: rootSql });
  const functions = createFunctionRuntime({
    artifacts: functionArtifacts,
    executions: functionExecutions,
    resolver: createFunctionDefinitionResolver({ ontology }),
    ontology,
    authorize: policy.authorizeFn,
    reads: createFunctionObjectReader(policy, root.history),
    actions,
    policyGeneration: () => policy.generation(),
    clock,
    nextId,
    afterActionBeforeResult: opts.afterActionBeforeResult,
  });
  const functionWorker = createFunctionWorker({
    runtime: functions,
    executions: functionExecutions,
    clock,
    workerId: nextId('fn-worker'),
  });

  const ctx: PlatformContext = {
    mode: 'postgres',
    ontology,
    objects: root.objects,
    links: root.links,
    graph,
    actions,
    events: root.events,
    audit: standaloneAudit,
    history: root.history,
    er,
    functions,
    functionArtifacts,
    functionWorker,
    policy,
    authorizer: policy,
    policyAdmin,
    projections,
    mappings,
    mappingVersions,
    connectorRegistrations,
    ingestion,
    ingestionWorker,
    outbox: root.outbox,
    executions: root.executions,
    ready: false,
    sql: rootSql,
    close: async () => {
      ctx.ready = false;
      await policy.close();
      await closeSql?.();
    },
  };

  if (opts.seed) {
    await opts.seed(ctx);
  }
  ctx.ready = true;
  return ctx;
}

export { fixtureOverlay };
