/**
 * action-engine — src/core/types.ts
 */

import type {
  ActionTypeDef,
  AuthorizeFn,
  AuditLog,
  LinkRepository,
  ObjectRepository,
  OperationalEventStore,
  OntologyId,
} from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateActionExecutorOptions {
  objects: ObjectRepository;
  links: LinkRepository;
  /** Optional: hash-chained audit (policy-engine). */
  audit?: AuditLog;
  events?: OperationalEventStore;
  authorize?: AuthorizeFn;
  clock?: Clock;
  nextId?: IdGenerator;
  /** Seed ActionTypeDefs per ontology. */
  actionTypes?: Record<OntologyId, ActionTypeDef[]>;
}
