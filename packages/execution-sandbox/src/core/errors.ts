/**
 * execution-sandbox — src/core/errors.ts
 */

import type { SandboxDenyReason } from 'contracts';

export class SandboxEscapeError extends Error {
  override readonly name = 'SandboxEscapeError';
  readonly reason: SandboxDenyReason;

  constructor(reason: SandboxDenyReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
  }
}
