/**
 * policy-engine — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;
export type SaltGenerator = () => string;

export interface CreatePolicyEngineOptions {
  clock?: Clock;
  nextId?: IdGenerator;
}

export interface CreateAuditLogOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Determinístico nos testes; default: crypto random. */
  nextSalt?: SaltGenerator;
  /** Commit automático a cada N eventos (0 = só manual). */
  autoCommitEvery?: number;
}
