/**
 * policy-engine — src/core/types.ts
 */

import type { AuthzDecision, Epid, PolicyOperation, PrincipalId, ResourceId } from 'contracts';

import type { PolicyStore } from './policy-store.js';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;
export type SaltGenerator = () => string;

export interface DecisionRecord {
  principal: PrincipalId;
  resource: ResourceId;
  operation: PolicyOperation;
  decision: AuthzDecision;
  principalEpids: Epid[];
  resourceEpid: Epid | null;
  reason: string;
  at: string;
}

export interface CreatePolicyEngineOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  store?: PolicyStore;
  /** Opt-in decision log. Default: noop (tests). */
  onDecision?: (d: DecisionRecord) => void;
  /** Fraction of allow decisions to log (denies/partial always). Default 0.1. */
  allowSampleRate?: number;
  /** Seed for deterministic allow sampling. */
  sampleSeed?: string;
}

export interface CreateAuditLogOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Determinístico nos testes; default: crypto random. */
  nextSalt?: SaltGenerator;
  /** Commit automático a cada N eventos (0 = só manual). */
  autoCommitEvery?: number;
  /** Durable backend. Default: in-memory (tests/demos only). */
  repository?: import('contracts').AuditRepository;
}
