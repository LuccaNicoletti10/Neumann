/**
 * action-engine — src/core/types.ts
 */

import type {
  ActionDefinitionResolver,
  ActionExecutionStore,
  AuditLog,
  AuthorizeFn,
  LinkRepository,
  ObjectRepository,
  OperationalEventStore,
  OntologyRegistry,
  OutboxRepository,
} from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface ActionTransactionStores {
  objects: ObjectRepository;
  links: LinkRepository;
  events: OperationalEventStore;
  audit: AuditLog;
  executions: ActionExecutionStore;
  outbox?: OutboxRepository;
}

export interface ActionUnitOfWork {
  run<T>(fn: (stores: ActionTransactionStores) => Promise<T>): Promise<T>;
}

export interface CreateActionExecutorOptions {
  objects: ObjectRepository;
  links: LinkRepository;
  /** Optional: hash-chained audit (policy-engine). */
  audit?: AuditLog;
  events?: OperationalEventStore;
  executions?: ActionExecutionStore;
  outbox?: OutboxRepository;
  authorize: AuthorizeFn;
  mode?: 'memory' | 'production';
  unitOfWork?: ActionUnitOfWork;
  clock?: Clock;
  nextId?: IdGenerator;
  /**
   * Ontology is the ActionType source (ADR-0006). Required unless `resolver` is set.
   */
  ontology?: OntologyRegistry;
  /** Injected resolver; default is createOntologyActionResolver(ontology). */
  resolver?: ActionDefinitionResolver;
  /** Observed at apply and stored on the envelope. Resume reauthorizes live policy. */
  policyGeneration?: () => number;
}
