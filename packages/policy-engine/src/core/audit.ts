/**
 * policy-engine — src/core/audit.ts
 * Audit log hash-chained + redigível + verificação (US20150188715).
 */

import type { AuditEntry, AuditLog, AuditVerifyResult } from 'contracts';

import {
  createDeterministicClock,
  createDeterministicSalt,
  createIdGenerator,
} from './determinism.js';
import { sha256Hex } from './hash.js';
import type { CreateAuditLogOptions } from './types.js';

function computeLogHash(eventData: string | null, salt: string | null): string {
  return sha256Hex([eventData ?? 'REDACTED', salt ?? '']);
}

function computeSummaryHash(
  logHash: string,
  metadata: Record<string, string>,
  previousSummaryHash: string | null,
): string {
  const meta = Object.keys(metadata)
    .sort()
    .map((k) => `${k}=${metadata[k]}`)
    .join('&');
  return sha256Hex([logHash, meta, previousSummaryHash]);
}

function verifyEntries(entries: readonly AuditEntry[]): AuditVerifyResult {
  let previous: string | null = null;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    if (e.previousSummaryHash !== previous) {
      return {
        ok: false,
        checked: i,
        brokenAt: i,
        reason: `previousSummaryHash mismatch at ${e.id}`,
      };
    }

    // REDACTED: eventData/salt removidos, mas logHash/summaryHash devem bater com chain.
    if (e.messageType !== 'REDACTED') {
      const expectedLog = computeLogHash(e.eventData, e.salt);
      if (expectedLog !== e.logHash) {
        return {
          ok: false,
          checked: i,
          brokenAt: i,
          reason: `logHash tamper at ${e.id}`,
        };
      }
    }

    const expectedSummary = computeSummaryHash(e.logHash, e.metadata, e.previousSummaryHash);
    if (expectedSummary !== e.summaryHash) {
      return {
        ok: false,
        checked: i,
        brokenAt: i,
        reason: `summaryHash tamper at ${e.id}`,
      };
    }
    previous = e.summaryHash;
  }
  return { ok: true, checked: entries.length };
}

export function createAuditLog(opts: CreateAuditLogOptions = {}): AuditLog {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const nextSalt = opts.nextSalt ?? createDeterministicSalt();
  const autoCommitEvery = opts.autoCommitEvery ?? 0;

  const entries: AuditEntry[] = [];
  let eventSinceCommit = 0;

  function appendInternal(
    messageType: AuditEntry['messageType'],
    eventData: string | null,
    metadata: Record<string, string>,
    principal?: string,
  ): AuditEntry {
    const previous = entries.length > 0 ? entries[entries.length - 1]!.summaryHash : null;
    const salt = messageType === 'REDACTED' ? null : nextSalt();
    const logHash = computeLogHash(eventData, salt);
    const summaryHash = computeSummaryHash(logHash, metadata, previous);
    const entry: AuditEntry = {
      id: nextId('aud'),
      messageType,
      eventData,
      metadata,
      salt,
      logHash,
      summaryHash,
      previousSummaryHash: previous,
      at: clock(),
      principal,
    };
    entries.push(entry);
    return entry;
  }

  const log: AuditLog = {
    begin() {
      if (entries.length > 0) throw new Error('audit já iniciado');
      return appendInternal('GENESIS', 'EMPTY_MESSAGE', { kind: 'genesis' });
    },

    append(eventData, metadata = {}, principal) {
      if (entries.length === 0) log.begin();
      const entry = appendInternal('EVENT', eventData, metadata, principal);
      eventSinceCommit += 1;
      if (autoCommitEvery > 0 && eventSinceCommit >= autoCommitEvery) {
        log.commit('auto');
        eventSinceCommit = 0;
      }
      return entry;
    },

    commit(note = 'commit') {
      if (entries.length === 0) log.begin();
      const entry = appendInternal('COMMIT', note, { kind: 'commit' });
      eventSinceCommit = 0;
      return entry;
    },

    redact(entryId) {
      const idx = entries.findIndex((e) => e.id === entryId);
      if (idx < 0) throw new Error(`entrada desconhecida: ${entryId}`);
      const e = entries[idx]!;
      if (e.messageType === 'GENESIS' || e.messageType === 'COMMIT') {
        throw new Error('não é possível redigir GENESIS/COMMIT');
      }
      // Preserva logHash/summaryHash/previous — só ofusca payload (US20150188715).
      const redacted: AuditEntry = {
        ...e,
        messageType: 'REDACTED',
        eventData: null,
        salt: null,
      };
      entries[idx] = redacted;
      return redacted;
    },

    verify() {
      return verifyEntries(entries);
    },

    detectTamper(mutated) {
      return verifyEntries(mutated);
    },

    list() {
      return entries;
    },

    head() {
      return entries[entries.length - 1];
    },
  };

  return log;
}
