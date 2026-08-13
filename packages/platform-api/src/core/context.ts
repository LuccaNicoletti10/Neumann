/**
 * platform-api — src/core/context.ts
 * Explicit memory vs postgres platform wiring (P11).
 */

import {
  createActionExecutor,
  createMemoryOperationalEventStore,
} from 'action-engine';
import type {
  ActionExecutor,
  LinkRepository,
  ObjectRepository,
  OperationalEventStore,
  OntologyRegistry,
} from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
  createPgLinkRepository,
  createPgObjectRepository,
  createSystemClock,
  createUuidIdGenerator,
  type SqlClient,
} from 'object-platform';
import { createGraphQueryEngine, type GraphQueryEngine } from 'knowledge-graph';
import { createOntologyRegistry } from 'ontology-registry';
import { createAuditLog } from 'policy-engine';

export interface PlatformContext {
  mode: 'memory' | 'postgres';
  ontology: OntologyRegistry;
  objects: ObjectRepository;
  links: LinkRepository;
  graph: GraphQueryEngine;
  actions: ActionExecutor;
  events: OperationalEventStore;
  audit: ReturnType<typeof createAuditLog>;
}

export interface CreateMemoryPlatformContextOptions {
  seed?: (ctx: PlatformContext) => void;
  /** When true (default for tests), use deterministic clock/ids. */
  deterministic?: boolean;
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
  const actions = createActionExecutor({
    objects,
    links,
    audit,
    events,
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
  opts.seed?.(ctx);
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
  sql: SqlClient;
  databaseUrl?: string;
  seed?: (ctx: PlatformContext) => void;
}

/**
 * Durable production context. Fail-fast if sql client missing.
 * Does NOT silently fall back to memory.
 */
export function createPostgresPlatformContext(
  opts: CreatePostgresPlatformContextOptions,
): PlatformContext {
  if (!opts.sql) {
    throw new Error(
      'createPostgresPlatformContext requires sql client (set DATABASE_URL / SqlClient)',
    );
  }
  const clock = createSystemClock();
  const nextId = createUuidIdGenerator();
  // Ontology remains memory until PgOntologyRegistry lands (Phase C); still fail-closed on objects.
  const ontology = createOntologyRegistry({ clock, nextId });
  const objects = createPgObjectRepository({ sql: opts.sql, clock, nextId });
  const links = createPgLinkRepository({ sql: opts.sql, clock, nextId });
  const graph = createGraphQueryEngine({ objects, links });
  const audit = createAuditLog({ clock, nextId });
  const events = createMemoryOperationalEventStore({ clock, nextId });
  const actions = createActionExecutor({
    objects,
    links,
    audit,
    events,
    clock,
    nextId,
  });
  const ctx: PlatformContext = {
    mode: 'postgres',
    ontology,
    objects,
    links,
    graph,
    actions,
    events,
    audit,
  };
  opts.seed?.(ctx);
  return ctx;
}
