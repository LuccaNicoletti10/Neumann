/**
 * contracts — src/v1/sandbox.ts
 * Execution sandbox (Passo 14 / US20250265045A1). Shape congelado.
 */

export type SandboxDenyReason =
  | 'TIMEOUT'
  | 'MEMORY_LIMIT'
  | 'FS_ESCAPE'
  | 'NETWORK_DENIED'
  | 'IDENTITY_REQUIRED'
  | 'FORBIDDEN_API'
  | 'OUTPUT_TOO_LARGE'
  | 'EXECUTION_ERROR';

export interface SandboxPolicy {
  /** Soft wall-clock budget (ms) — enforced via injectable clock ticks + step count. */
  maxCpuMs: number;
  /** Max serialized output/input bytes. */
  maxMemoryBytes: number;
  /** Paths relative allowlist (prefix). Empty = no FS. */
  fsAllowPrefixes: string[];
  /** Network always off no kernel unless true (default false). */
  allowNetwork: boolean;
  /** Max audit payload size. */
  maxOutputBytes: number;
}

export interface SandboxIdentity {
  subjectId: string;
  displayName: string;
  roles: string[];
}

export interface SandboxAuditEvent {
  id: string;
  at: string;
  identityId: string;
  transformId: string;
  ok: boolean;
  deniedReason?: SandboxDenyReason;
  detail?: string;
  durationMs: number;
  bytesIn: number;
  bytesOut: number;
}

export interface SandboxRunResult {
  ok: boolean;
  output?: unknown;
  deniedReason?: SandboxDenyReason;
  detail?: string;
  auditId: string;
  durationMs: number;
}

export function buildGoldenSandboxPolicy(): SandboxPolicy {
  return {
    maxCpuMs: 50,
    maxMemoryBytes: 64_000,
    fsAllowPrefixes: ['tmp/', 'workspace/'],
    allowNetwork: false,
    maxOutputBytes: 32_000,
  };
}
