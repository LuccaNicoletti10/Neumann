/**
 * policy-engine — src/core/audit.ts
 * Audit log hash-chained + redigível + verificação (US20150188715).
 *
 * Persistence is delegated to AuditRepository (memory or PostgreSQL).
 * Hash-chain previousSummaryHash is determined inside the repository.
 */

import type { AuditEntry, AuditLog, AuditRepository } from 'contracts';

import { verifyEntries } from './audit-hash.js';
import {
  createDeterministicClock,
  createDeterministicSalt,
  createIdGenerator,
} from './determinism.js';
import { createMemoryAuditRepository } from './memory-audit-repository.js';
import type { CreateAuditLogOptions, DecisionRecord } from './types.js';

export { computeLogHash, computeSummaryHash, verifyEntries } from './audit-hash.js';
export { createMemoryAuditRepository } from './memory-audit-repository.js';
export { createPgAuditRepository } from './pg-audit-repository.js';
export type { CreatePgAuditRepositoryOptions } from './pg-audit-repository.js';

export async function recordDecision(audit: AuditLog, d: DecisionRecord) {
  return audit.append(
    JSON.stringify(d),
    {
      kind: 'PolicyDecision',
      decision: d.decision,
      resource: d.resource,
      operation: d.operation,
    },
    d.principal,
  );
}

export function createDecisionLogSink(audit: AuditLog): {
  onDecision: (d: DecisionRecord) => void;
  drain: () => Promise<void>;
} {
  let chain = Promise.resolve();
  return {
    onDecision(d) {
      chain = chain
        .then(() => recordDecision(audit, d))
        .then(() => undefined)
        .catch((err) => {
          console.error('[policy-engine] decision log append failed:', err);
        });
    },
    drain: () => chain,
  };
}

export function createAuditLog(opts: CreateAuditLogOptions = {}): AuditLog {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const nextSalt = opts.nextSalt ?? createDeterministicSalt();
  const autoCommitEvery = opts.autoCommitEvery ?? 0;
  const repo: AuditRepository = opts.repository ?? createMemoryAuditRepository();

  let eventSinceCommit = 0;

  async function appendInternal(
    messageType: AuditEntry['messageType'],
    eventData: string | null,
    metadata: Record<string, string>,
    principal?: string,
  ): Promise<AuditEntry> {
    return repo.appendChained({
      id: nextId('aud'),
      messageType,
      eventData,
      metadata,
      salt: messageType === 'REDACTED' ? null : nextSalt(),
      at: clock(),
      principal,
    });
  }

  const log: AuditLog = {
    async begin() {
      const existing = await repo.head();
      if (existing) throw new Error('audit já iniciado');
      return appendInternal('GENESIS', 'EMPTY_MESSAGE', { kind: 'genesis' });
    },

    async append(eventData, metadata = {}, principal) {
      if (!(await repo.head())) {
        try {
          await log.begin();
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes('já iniciado')) throw err;
        }
      }
      const entry = await appendInternal('EVENT', eventData, metadata, principal);
      eventSinceCommit += 1;
      if (autoCommitEvery > 0 && eventSinceCommit >= autoCommitEvery) {
        await log.commit('auto');
        eventSinceCommit = 0;
      }
      return entry;
    },

    async commit(note = 'commit') {
      if (!(await repo.head())) {
        try {
          await log.begin();
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes('já iniciado')) throw err;
        }
      }
      const entry = await appendInternal('COMMIT', note, { kind: 'commit' });
      eventSinceCommit = 0;
      return entry;
    },

    async redact(entryId) {
      return repo.redact(entryId);
    },

    async verify() {
      return verifyEntries(await repo.list());
    },

    detectTamper(mutated) {
      return verifyEntries(mutated);
    },

    async list() {
      return repo.list();
    },

    async head() {
      return repo.head();
    },
  };

  return log;
}
