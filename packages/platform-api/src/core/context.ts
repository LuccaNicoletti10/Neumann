/**
 * platform-api — src/core/context.ts
 * Explicit memory vs postgres platform wiring (P11).
 */

import {
  createActionExecutor,
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
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
  createPgLinkRepository,
  createPgObjectRepository,
  createPgSqlClient,
  createSystemClock,
  createUuidIdGenerator,
} from 'object-platform';
import { createGraphQueryEngine, type GraphQueryEngine } from 'knowledge-graph';
import { createOntologyRegistry, createPgOntologyRegistry } from 'ontology-registry';
import {
  createAuditLog,
  createPgAuditRepository,
} from 'policy-engine';

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
  close?: () => Promise<void>;
}

export interface CreateMemoryPlatformContextOptions {
  seed?: (ctx: PlatformContext) => void | Promise<void>;
  /** When true (default for tests), use deterministic clock/ids. */
  deterministic?: boolean;
  /** Tests may override; default is explicit allowAll. */
  authorize?: AuthorizeFn;
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
  });
  const graph = createGraphQueryEngine({ objects, links });
  const audit = createAuditLog({ clock, nextId });
  const events = createMemoryOperationalEventStore({ clock, nextId });
  const executions = createMemoryActionExecutionStore();
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

  function bind(client: SqlClient) {
    const objects = createPgObjectRepository({ sql: client, clock, nextId });
    const links = createPgLinkRepository({ sql: client, clock, nextId });
    const events = createPgOperationalEventStore({ sql: client, clock, nextId });
    const executions = createPgActionExecutionStore({ sql: client });
    const audit = createAuditLog({
      clock,
      nextId,
      repository: createPgAuditRepository({ sql: client }),
    });
    const outbox = createPgOutboxRepository({ sql: client });
    return { objects, links, events, executions, audit, outbox };
  }

  const root = bind(rootSql);
  const ontology = createPgOntologyRegistry({ sql: rootSql, clock, nextId });
  const graph = createGraphQueryEngine({ objects: root.objects, links: root.links });

  const unitOfWork: ActionUnitOfWork = {
    run: (fn) => txManager.transaction((tx) => fn(bind(tx))),
  };

  const standaloneAudit = createAuditLog({
    clock,
    nextId,
    repository: createPgAuditRepository({ sql: rootSql, transaction: txManager }),
  });

  const actions = createActionExecutor({
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

  const ctx: PlatformContext = {
    mode: 'postgres',
    ontology,
    objects: root.objects,
    links: root.links,
    graph,
    actions,
    events: root.events,
    audit: standaloneAudit,
    close,
  };
  void opts.seed?.(ctx);
  return ctx;
}
