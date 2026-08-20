/**
 * execution-sandbox — src/worker/entry.ts
 * Worker entry: eval transform in a vm context without require/fs/net.
 */
import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

import { detectForbiddenApi } from './forbidden-api.js';

const data = workerData as {
  transformSource: string;
  input: unknown;
  policy: {
    maxCpuMs: number;
    maxMemoryBytes: number;
    fsAllowPrefixes: string[];
    allowNetwork: boolean;
  };
  files: Record<string, string>;
};

function isPathAllowed(path: string, prefixes: string[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.includes('..') || normalized.startsWith('/')) return false;
  return prefixes.some((raw) => {
    const p = raw.endsWith('/') ? raw : `${raw}/`;
    return normalized === raw.replace(/\/$/, '') || normalized.startsWith(p);
  });
}

try {
  const files = { ...data.files };
  const host = {
    readFile(path: string) {
      if (!isPathAllowed(path, data.policy.fsAllowPrefixes)) {
        throw new Error(`FS_ESCAPE: read denied: ${path}`);
      }
      const content = files[path];
      if (content === undefined) throw new Error(`FS_ESCAPE: missing: ${path}`);
      return content;
    },
    writeFile(path: string, content: string) {
      if (!isPathAllowed(path, data.policy.fsAllowPrefixes)) {
        throw new Error(`FS_ESCAPE: write denied: ${path}`);
      }
      files[path] = content;
    },
    fetch(url: string) {
      if (!data.policy.allowNetwork) throw new Error(`NETWORK_DENIED: fetch blocked: ${url}`);
      return { ok: true, body: '' };
    },
    tick() {
      /* wall-clock timeout is enforced by the host via worker.terminate */
    },
  };

  const context = vm.createContext({
    input: data.input,
    host,
    result: undefined as unknown,
    console: { log() {}, warn() {}, error() {} },
  });
  const src = data.transformSource.trim();
  vm.runInContext(`result = (${src})(input, host);`, context, { timeout: data.policy.maxCpuMs });
  parentPort?.postMessage({
    ok: true,
    output: (context as { result: unknown }).result,
    files,
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  let reason = 'EXECUTION_ERROR';
  if (message.includes('FS_ESCAPE')) reason = 'FS_ESCAPE';
  else if (message.includes('NETWORK_DENIED')) reason = 'NETWORK_DENIED';
  else if (/timed out|timeout/i.test(message)) reason = 'TIMEOUT';
  else if (detectForbiddenApi(data.transformSource, message)) reason = 'FORBIDDEN_API';
  parentPort?.postMessage({ ok: false, reason, error: message });
}
