/**
 * platform-api — src/core/context.ts
 * Wires ontology registry + object/link repos + action executor.
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
} from 'object-platform';
import { createOntologyRegistry } from 'ontology-registry';
import { createAuditLog } from 'policy-engine';

export interface PlatformContext {
  ontology: OntologyRegistry;
  objects: ObjectRepository;
  links: LinkRepository;
  actions: ActionExecutor;
  events: OperationalEventStore;
  audit: ReturnType<typeof createAuditLog>;
}

export interface CreatePlatformContextOptions {
  seed?: (ctx: PlatformContext) => void;
}

export function createPlatformContext(
  opts: CreatePlatformContextOptions = {},
): PlatformContext {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const ontology = createOntologyRegistry({ clock, nextId });
  const objects = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({ clock, nextId });
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
    ontology,
    objects,
    links,
    actions,
    events,
    audit,
  };
  opts.seed?.(ctx);
  return ctx;
}
