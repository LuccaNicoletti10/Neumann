/**
 * offline-sync — src/core/converge.ts
 */

import type { PrincipalId } from 'contracts';

import type { Replica } from './replica.js';

export function statesConverged(replicas: readonly Replica[], principal: PrincipalId): boolean {
  if (replicas.length === 0) return true;
  const first = replicas[0];
  if (!first) return true;
  const expected = first.authorizedState(principal);
  return replicas.every((r) => r.authorizedState(principal) === expected);
}
