/**
 * execution-sandbox — src/core/sandbox.ts
 * Execução de transforms com identidade + audit; escapes bloqueados.
 */

import type {
  SandboxAuditEvent,
  SandboxDenyReason,
  SandboxIdentity,
  SandboxPolicy,
  SandboxRunResult,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { SandboxEscapeError } from './errors.js';
import { createRestrictedHost, type HostState } from './host.js';
import { byteLength, resolvePolicy } from './policy.js';
import type { CreateSandboxOptions, SandboxedFn } from './types.js';
import { runInWorker, type WorkerFailReason } from './worker-runner.js';

const SANDBOX_DENY_REASONS: readonly SandboxDenyReason[] = [
  'TIMEOUT',
  'MEMORY_LIMIT',
  'FS_ESCAPE',
  'NETWORK_DENIED',
  'IDENTITY_REQUIRED',
  'FORBIDDEN_API',
  'OUTPUT_TOO_LARGE',
  'EXECUTION_ERROR',
];

function isSandboxDenyReason(value: string): value is SandboxDenyReason {
  return (SANDBOX_DENY_REASONS as readonly string[]).includes(value);
}

function workerReasonToDeny(reason: WorkerFailReason | string | undefined): SandboxDenyReason {
  if (reason === 'CANCELLED') return 'EXECUTION_ERROR';
  if (reason !== undefined && isSandboxDenyReason(reason)) return reason;
  return 'EXECUTION_ERROR';
}

export interface ExecutionSandbox {
  registerIdentity(identity: SandboxIdentity): void;
  seedFile(path: string, content: string): void;
  registerTransform(id: string, fn: SandboxedFn): void;
  run(args: {
    identityId: string;
    transformId: string;
    input: unknown;
  }): SandboxRunResult;
  runAsync(args: {
    identityId: string;
    transformId: string;
    input: unknown;
  }): Promise<SandboxRunResult>;
  auditLog(): SandboxAuditEvent[];
  policy(): SandboxPolicy;
}

export function createExecutionSandbox(
  options: CreateSandboxOptions = {},
): ExecutionSandbox {
  const clock = options.clock ?? createDeterministicClock();
  const nextId = options.nextId ?? createIdGenerator();
  const policy = resolvePolicy(options.policy);

  const identities = new Map<string, SandboxIdentity>();
  const transforms = new Map<string, SandboxedFn>();
  const transformSource = new Map<string, string>();
  const files = new Map<string, string>();
  const audit: SandboxAuditEvent[] = [];
  const isolation = options.isolation ?? 'in-process';
  const timeoutMs = options.timeoutMs ?? policy.maxCpuMs;

  function deny(
    identityId: string,
    transformId: string,
    reason: SandboxRunResult['deniedReason'],
    detail: string,
    durationMs: number,
    bytesIn: number,
  ): SandboxRunResult {
    const auditId = nextId('audit');
    audit.push({
      id: auditId,
      at: clock(),
      identityId,
      transformId,
      ok: false,
      deniedReason: reason,
      detail,
      durationMs,
      bytesIn,
      bytesOut: 0,
    });
    return {
      ok: false,
      deniedReason: reason,
      detail,
      auditId,
      durationMs,
    };
  }

  return {
    registerIdentity(identity) {
      identities.set(identity.subjectId, {
        ...identity,
        roles: [...identity.roles],
      });
    },
    seedFile(path, content) {
      files.set(path.replace(/\\/g, '/').replace(/^\.\//, ''), content);
    },
    registerTransform(id, fn) {
      transforms.set(id, fn);
      transformSource.set(id, fn.toString());
    },
    policy() {
      return { ...policy, fsAllowPrefixes: [...policy.fsAllowPrefixes] };
    },
    auditLog() {
      return audit.map((e) => ({ ...e }));
    },
    async runAsync(args: { identityId: string; transformId: string; input: unknown }) {
      if (isolation !== 'worker') {
        return this.run(args);
      }
      const started = Date.now();
      const bytesIn = byteLength(args.input);
      if (!identities.has(args.identityId)) {
        return deny(args.identityId, args.transformId, 'IDENTITY_REQUIRED', 'unknown identity', 0, bytesIn);
      }
      const source = transformSource.get(args.transformId);
      if (!source) {
        return deny(args.identityId, args.transformId, 'FORBIDDEN_API', `unknown transform: ${args.transformId}`, 0, bytesIn);
      }
      const result = await runInWorker({
        transformSource: source,
        input: args.input,
        policy,
        files: Object.fromEntries(files),
        timeoutMs,
      });
      const durationMs = Date.now() - started;
      if (!result.ok) {
        const reason = workerReasonToDeny(result.reason);
        return deny(args.identityId, args.transformId, reason, result.error ?? 'worker failed', durationMs, bytesIn);
      }
      if (result.files) {
        for (const [k, v] of Object.entries(result.files)) files.set(k, v);
      }
      const bytesOut = byteLength(result.output);
      const auditId = nextId('audit');
      audit.push({
        id: auditId,
        at: clock(),
        identityId: args.identityId,
        transformId: args.transformId,
        ok: true,
        durationMs,
        bytesIn,
        bytesOut,
      });
      return { ok: true, output: result.output, auditId, durationMs };
    },
    run({ identityId, transformId, input }) {
      const started = clock();
      const bytesIn = byteLength(input);

      if (!identities.has(identityId)) {
        return deny(identityId, transformId, 'IDENTITY_REQUIRED', 'unknown identity', 0, bytesIn);
      }
      if (bytesIn > policy.maxMemoryBytes) {
        return deny(
          identityId,
          transformId,
          'MEMORY_LIMIT',
          `input ${bytesIn}b`,
          0,
          bytesIn,
        );
      }

      const fn = transforms.get(transformId);
      if (!fn) {
        return deny(
          identityId,
          transformId,
          'FORBIDDEN_API',
          `unknown transform: ${transformId}`,
          0,
          bytesIn,
        );
      }

      const state: HostState = {
        cpuMsUsed: 0,
        fsReads: 0,
        fsWrites: 0,
        files: new Map(files),
      };
      const host = createRestrictedHost(policy, state);

      try {
        // Baseline CPU cost
        host.tick(1);
        const output = fn(input, host);
        const bytesOut = byteLength(output);
        if (bytesOut > policy.maxOutputBytes || bytesOut > policy.maxMemoryBytes) {
          return deny(
            identityId,
            transformId,
            'OUTPUT_TOO_LARGE',
            `output ${bytesOut}b`,
            state.cpuMsUsed,
            bytesIn,
          );
        }

        // Persist FS writes from sandbox back to store (only allowlisted succeeded)
        for (const [k, v] of state.files) {
          files.set(k, v);
        }

        const durationMs = state.cpuMsUsed;
        const auditId = nextId('audit');
        audit.push({
          id: auditId,
          at: clock(),
          identityId,
          transformId,
          ok: true,
          durationMs,
          bytesIn,
          bytesOut,
        });
        void started;
        return { ok: true, output, auditId, durationMs };
      } catch (err) {
        if (err instanceof SandboxEscapeError) {
          return deny(
            identityId,
            transformId,
            err.reason,
            err.message,
            state.cpuMsUsed,
            bytesIn,
          );
        }
        return deny(
          identityId,
          transformId,
          'FORBIDDEN_API',
          err instanceof Error ? err.message : String(err),
          state.cpuMsUsed,
          bytesIn,
        );
      }
    },
  };
}
