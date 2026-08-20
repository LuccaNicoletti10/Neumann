import { byteLength } from 'execution-sandbox';
import { runInWorker, type WorkerFailReason } from 'execution-sandbox';

import { artifactSource } from './artifact-hash.js';
import type { FunctionFailureCode, FunctionObjectInput } from 'contracts';

export interface FunctionSandboxLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxMemoryMb: number;
  maxLogBytes: number;
}

export interface FunctionSandboxResult {
  ok: boolean;
  output?: unknown;
  code?: FunctionFailureCode;
  detail?: string;
}

export function classifyFunctionSandboxFailure(
  reason: WorkerFailReason | string | undefined,
  error?: string,
): FunctionFailureCode {
  if (error && /OUTPUT_LIMIT/.test(error)) return 'OUTPUT_LIMIT';
  if (reason === 'TIMEOUT') return 'TIMEOUT';
  if (reason === 'MEMORY_LIMIT') return 'MEMORY_LIMIT';
  if (reason === 'FORBIDDEN_API' || reason === 'FS_ESCAPE' || reason === 'NETWORK_DENIED') {
    return 'FORBIDDEN_API';
  }
  if (reason === 'CANCELLED') return 'CANCELLED';
  return 'EXECUTION_ERROR';
}

function seedFromExecutionId(executionId: string): number {
  let h = 2166136261;
  for (let i = 0; i < executionId.length; i += 1) {
    h ^= executionId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function runFunctionArtifact(opts: {
  bytes: Uint8Array;
  objects: FunctionObjectInput[];
  parameters: Record<string, unknown>;
  clock: string;
  executionId: string;
  limits: FunctionSandboxLimits;
  signal?: AbortSignal;
}): Promise<FunctionSandboxResult> {
  const source = artifactSource(opts.bytes);
  const seed = seedFromExecutionId(opts.executionId);
  const wrapped = `function(input, host) {
    var t = ${seed} >>> 0;
    function random() {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    }
    var logUsed = 0;
    var logMax = ${opts.limits.maxLogBytes};
    var caps = {
      now: function() { return input.clock; },
      random: random,
      log: function() {
        var s = '';
        for (var i = 0; i < arguments.length; i++) s += String(arguments[i]);
        logUsed += s.length;
        if (logUsed > logMax) throw new Error('OUTPUT_LIMIT');
      }
    };
    return (${source})(input, Object.assign({}, host, caps));
  }`;
  const result = await runInWorker({
    transformSource: wrapped,
    input: {
      objects: opts.objects,
      params: opts.parameters,
      clock: opts.clock,
    },
    policy: {
      maxCpuMs: opts.limits.timeoutMs,
      maxMemoryBytes: opts.limits.maxMemoryMb * 1024 * 1024,
      fsAllowPrefixes: [],
      allowNetwork: false,
    },
    files: {},
    timeoutMs: opts.limits.timeoutMs,
    resourceLimits: { maxOldGenerationSizeMb: opts.limits.maxMemoryMb },
    signal: opts.signal,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: classifyFunctionSandboxFailure(result.reason, result.error),
      detail: result.error ?? 'sandbox failed',
    };
  }
  const bytesOut = byteLength(result.output);
  if (bytesOut > opts.limits.maxOutputBytes) {
    return { ok: false, code: 'OUTPUT_LIMIT', detail: 'output exceeded limit' };
  }
  return { ok: true, output: result.output };
}
