import type { ActionExecutionStore, ActionTypeDef, AuthorizeFn, ObjectRepository } from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';
import { createAuditLog } from 'policy-engine';

import { createActionExecutor } from '../src/index.js';
import { seedActionOntology } from './seed-ontology.js';

const allow: AuthorizeFn = () => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: 'ok',
});

export async function executorHarness(
  actions: ActionTypeDef[],
  opts: {
    authorize?: AuthorizeFn;
    objects?: ObjectRepository;
    executions?: ActionExecutionStore;
    clock?: () => string;
    nextId?: (p: string) => string;
    objectTypeIds?: string[];
  } = {},
) {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const { ontology, ontologyId } = await seedActionOntology({
    actions,
    objectTypeIds: opts.objectTypeIds,
    clock,
    nextId,
  });
  const objects = opts.objects ?? createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({ clock, nextId });
  const audit = createAuditLog({ clock, nextId });
  const exec = createActionExecutor({
    objects,
    links,
    audit,
    ontology,
    clock,
    nextId,
    executions: opts.executions,
    authorize: opts.authorize ?? allow,
  });
  return { exec, objects, links, audit, ontology, ontologyId, clock, nextId };
}
