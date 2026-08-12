/**
 * execution-sandbox — src/core/host.ts
 * Host restrito: FS allowlist, rede bloqueada, CPU ticks.
 */

import type { SandboxPolicy } from 'contracts';

import { SandboxEscapeError } from './errors.js';
import { isPathAllowed } from './policy.js';
import type { SandboxHost } from './types.js';

export interface HostState {
  cpuMsUsed: number;
  fsReads: number;
  fsWrites: number;
  files: Map<string, string>;
}

export function createRestrictedHost(
  policy: SandboxPolicy,
  state: HostState,
): SandboxHost {
  return {
    readFile(path) {
      if (!isPathAllowed(path, policy.fsAllowPrefixes)) {
        throw new SandboxEscapeError('FS_ESCAPE', `read denied: ${path}`);
      }
      state.fsReads += 1;
      const content = state.files.get(normalize(path));
      if (content === undefined) {
        throw new SandboxEscapeError('FS_ESCAPE', `missing: ${path}`);
      }
      return content;
    },
    writeFile(path, content) {
      if (!isPathAllowed(path, policy.fsAllowPrefixes)) {
        throw new SandboxEscapeError('FS_ESCAPE', `write denied: ${path}`);
      }
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > policy.maxMemoryBytes) {
        throw new SandboxEscapeError('MEMORY_LIMIT', `write ${bytes}b`);
      }
      state.fsWrites += 1;
      state.files.set(normalize(path), content);
    },
    fetch(url) {
      if (!policy.allowNetwork) {
        throw new SandboxEscapeError('NETWORK_DENIED', `fetch blocked: ${url}`);
      }
      return { ok: true, body: '' };
    },
    tick(n = 1) {
      state.cpuMsUsed += Math.max(1, n);
      if (state.cpuMsUsed > policy.maxCpuMs) {
        throw new SandboxEscapeError(
          'TIMEOUT',
          `cpu ${state.cpuMsUsed}ms > ${policy.maxCpuMs}ms`,
        );
      }
    },
  };
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
