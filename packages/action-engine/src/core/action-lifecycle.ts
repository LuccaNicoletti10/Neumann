/**
 * Action execution state machine. One table; callers do not scatter `if status`.
 *
 * WHY: illegal transitions (terminal → running, approve from SUCCEEDED) must be
 * unrepresentable at the assignment site, not discovered after a write-back.
 */

import type { ActionExecution, ActionExecutionStatus } from 'contracts';

const LEGAL: Record<ActionExecutionStatus, readonly ActionExecutionStatus[]> = {
  PENDING: ['AUTHORIZED', 'DENIED', 'FAILED'],
  AUTHORIZED: ['VALIDATED', 'DENIED', 'FAILED'],
  VALIDATED: ['RUNNING', 'AWAITING_APPROVAL', 'FAILED'],
  AWAITING_APPROVAL: ['RUNNING', 'REJECTED', 'DENIED', 'FAILED'],
  RUNNING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
  DENIED: [],
  REJECTED: [],
};

/** Statuses that never leave. Duplicate approve/apply returns the persisted row. */
export function isTerminalStatus(status: ActionExecutionStatus): boolean {
  return (LEGAL[status] ?? []).length === 0;
}

export function assertActionTransition(
  from: ActionExecutionStatus,
  to: ActionExecutionStatus,
): void {
  if (!(LEGAL[from] ?? []).includes(to)) {
    throw new Error(`illegal action transition: ${from} → ${to}`);
  }
}

/**
 * Assign `to` after checking the table. Mutates in place.
 */
export function transitionExecution(
  execution: ActionExecution,
  to: ActionExecutionStatus,
): void {
  assertActionTransition(execution.status, to);
  execution.status = to;
}
