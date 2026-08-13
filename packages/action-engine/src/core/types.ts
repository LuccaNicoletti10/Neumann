/**
 * action-engine — src/core/types.ts
 */

import type {
  ActionExecutionStore,
  ActionTypeDef,
  AuditLog,
  AuthorizeFn,
  LinkRepository,
  ObjectRepository,
  OperationalEventStore,
  OntologyId,
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
  authorize?: AuthorizeFn;
  /**
   * `production` refuses missing authorize (fail-closed).
   * Memory/tests may omit authorize only when mode is not production.
   */
  mode?: 'memory' | 'production';
  unitOfWork?: ActionUnitOfWork;
  clock?: Clock;
  nextId?: IdGenerator;
  /** Seed ActionTypeDefs per ontology. */
  actionTypes?: Record<OntologyId, ActionTypeDef[]>;
}
