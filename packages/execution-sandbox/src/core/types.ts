/**
 * execution-sandbox — src/core/types.ts
 */

import type { SandboxPolicy } from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateSandboxOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  policy?: Partial<SandboxPolicy>;
}

/** Host APIs expostas ao transform — todas passam pelo guard. */
export interface SandboxHost {
  /** Lê path relativo; fora do allowlist → FS_ESCAPE. */
  readFile(path: string): string;
  /** Escreve path relativo; fora do allowlist → FS_ESCAPE. */
  writeFile(path: string, content: string): void;
  /** Sempre negado se policy.allowNetwork=false. */
  fetch(url: string): never | { ok: boolean; body: string };
  /** Contabiliza “CPU” em steps (cada call = 1ms lógico). */
  tick(n?: number): void;
}

export type SandboxedFn = (
  input: unknown,
  host: SandboxHost,
) => unknown;
