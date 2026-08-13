/**
 * platform-api — src/core/context.ts
 * Explicit memory vs postgres platform wiring (P11).
 */

import {
  createActionExecutor,
  createFailureSurvivingExecutor,
  createMemoryActionExecutionStore,
  createMemoryOperationalEventStore,
  createPgActionExecutionStore,
  createPgOperationalEventStore,
  type ActionUnitOfWork,
} from 'action-engine';
import type {
  ActionExecutor,
  AuthorizeFn,
  LinkRepository,
  ObjectRepository,
  OperationalEventStore,
  OntologyRegistry,
  SqlClient,
  TransactionManager,
} from 'contracts';
import { createPgOutboxRepository } from 'event-bus';
import {
  createDeterministicClock,
  createGovernedObjectRepository,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectHistoryStore,
  createMemoryObjectRepository,
  createPgLinkRepository,
  createPgObjectHistoryStore,
  createPgObjectRepository,
  createPgSqlClient,
  createSystemClock,
  createUuidIdGenerator,
  type ObjectHistoryStore,
} from 'object-platform';
import { createGraphQueryEngine, type GraphQueryEngine } from 'knowledge-graph';
import { createOntologyRegistry, createPgOntologyRegistry } from 'ontology-registry';
import {
  createAuditLog,
  createPgAuditRepository,
  type OntologyAuthorizer,
} from 'policy-engine';

import { getCurrentPrincipal } from './principal.js';

const allowAll: AuthorizeFn = (req) => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: `default-allow ${req.operation}`,
});

export interface PlatformContext {
  mode: 'memory' | 'postgres';
  ontology: OntologyRegistry;
  objects: ObjectRepository;
  links: LinkRepository;
  graph: GraphQueryEngine;
  actions: ActionExecutor;
  events: OperationalEventStore;
  audit: ReturnType<typeof createAuditLog>;
  history: ObjectHistoryStore;
  authorizer?: OntologyAuthorizer;
  close?: () => Promise<void>;
}

export interface CreateMemoryPlatformContextOptions {
  seed?: (ctx: PlatformContext) => void | Promise<void>;
  /** When true (default for tests), use deterministic clock/ids. */
  deterministic?: boolean;
  /** Tests may override; default is explicit allowAll. */
  authorize?: AuthorizeFn;
  authorizer?: OntologyAuthorizer;
}

/** Test/demo context — memory adapters only. */
export function createMemoryPlatformContext(
  opts: CreateMemoryPlatformContextOptions = {},
): PlatformContext {
  const deterministic = opts.deterministic !== false;
  const clock = deterministic ? createDeterministicClock() : createSystemClock();
  const nextId = deterministic ? createIdGenerator() : createUuidIdGenerator();
  const ontology = createOntologyRegistry({ clock, nextId });
  const objects = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({
    clock,
    nextId,
    objectExists: async (ontologyId, objectTypeId, primaryKey) =>
      Boolean(await objects.get(ontologyId, objectTypeId, primaryKey)),
    cardinalityOf: async (ontologyId, linkTypeId) => {
      const v = await ontology.getLatestVersion(ontologyId);
      return v?.linkTypes[linkTypeId]?.cardinality;
    },
  });
  const graph = createGraphQueryEngine({ objects, links });
  const audit = createAuditLog({ clock, nextId });
  const events = createMemoryOperationalEventStore({ clock, nextId });
  const executions = createMemoryActionExecutionStore();
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  const actions = createActionExecutor({
    objects,
    links,
    audit,
    events,
    executions,
    authorize: opts.authorize ?? allowAll,
    mode: 'memory',
    clock,
    nextId,
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
    authorizer: opts.authorizer,
  };
  void opts.seed?.(ctx);
  return ctx;
}

/**
 * @deprecated Use createMemoryPlatformContext for tests or createPostgresPlatformContext for runtime.
 * Defaults to memory + deterministic providers for backward-compatible tests.
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
  /** Required. Production is fail-closed — no allowAll default. */
  authorize: AuthorizeFn;
  /** Optional read/redact helper used by /api/v2 GET routes. */
  authorizer?: OntologyAuthorizer;
  /** enforce = reject undeclared writes; warn = log and allow. Default enforce. */
  governanceMode?: 'enforce' | 'warn';
  seed?: (ctx: PlatformContext) => void | Promise<void>;
}

/**
 * Durable production context. Fail-fast if sql/databaseUrl missing.
 * Does NOT silently fall back to memory.
 */
export function createPostgresPlatformContext(
  opts: CreatePostgresPlatformContextOptions,
): PlatformContext {
  if (!opts.authorize) {
    throw new Error(
      'createPostgresPlatformContext requires authorize (fail-closed; no allowAll default)',
    );
  }

  let sql = opts.sql;
  let transaction = opts.transaction;
  let close: (() => Promise<void>) | undefined;

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
    close = () => client.close();
  }

  if (!transaction) {
    throw new Error(
      'createPostgresPlatformContext requires TransactionManager (pass transaction or databaseUrl)',
    );
  }

  const clock = createSystemClock();
  const nextId = createUuidIdGenerator();
  const txManager = transaction;
  const rootSql = sql;
  const ontology = createPgOntologyRegistry({ sql: rootSql, clock, nextId });
  const governanceMode = opts.governanceMode ?? 'enforce';

  function bind(client: SqlClient) {
    const rawObjects = createPgObjectRepository({ sql: client, clock, nextId });
    const history = createPgObjectHistoryStore({ sql: client, nextId });
    const objects = createGovernedObjectRepository({
      inner: rawObjects,
      resolveVersion: (oid, vid) =>
        vid ? ontology.getVersion(vid) : ontology.getLatestVersion(oid),
      history,
      principal: () => getCurrentPrincipal(),
      mode: governanceMode,
      versionCacheTtlMs: 0,
    });
    const links = createPgLinkRepository({
      sql: client,
      clock,
      nextId,
      objectExists: async (ontologyId, objectTypeId, primaryKey) =>
        Boolean(await rawObjects.get(ontologyId, objectTypeId, primaryKey)),
      cardinalityOf: async (ontologyId, linkTypeId) => {
        const v = await ontology.getLatestVersion(ontologyId);
        return v?.linkTypes[linkTypeId]?.cardinality;
      },
    });
    const events = createPgOperationalEventStore({ sql: client, clock, nextId });
    const executions = createPgActionExecutionStore({ sql: client });
    const audit = createAuditLog({
      clock,
      nextId,
      repository: createPgAuditRepository({ sql: client }),
    });
    const outbox = createPgOutboxRepository({ sql: client });
    return { objects, links, events, executions, audit, outbox, history };
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

  const innerActions = createActionExecutor({
    objects: root.objects,
    links: root.links,
    audit: standaloneAudit,
    events: root.events,
    executions: root.executions,
    outbox: root.outbox,
    authorize: opts.authorize,
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
    authorizer: opts.authorizer,
    close,
  };
  void opts.seed?.(ctx);
  return ctx;
}
