/**
 * policy-engine — src/core/memory-audit-repository.ts
 * In-memory AuditRepository (unit tests / demos only).
 */

import type { AuditAppendInput, AuditEntry, AuditRepository } from 'contracts';

import { computeLogHash, computeSummaryHash } from './audit-hash.js';

/**
 * Structural capture/restore. WHY declared here instead of imported: audit must
 * join the memory transaction boundary without policy-engine depending on
 * object-platform. `MemoryCheckpoint` is structural, so this shape satisfies it.
 */
export interface CheckpointableAuditRepository extends AuditRepository {
  capture(): unknown;
  restore(snapshot: unknown): void;
}

export function createMemoryAuditRepository(): CheckpointableAuditRepository {
  const entries: AuditEntry[] = [];

  return {
    capture() {
      return entries.slice();
    },

    restore(snapshot: unknown) {
      entries.length = 0;
      entries.push(...(snapshot as AuditEntry[]));
    },

    async appendChained(input: AuditAppendInput): Promise<AuditEntry> {
      const previous = entries.length > 0 ? entries[entries.length - 1]! : undefined;
      if (input.messageType === 'GENESIS' && previous) {
        throw new Error('audit já iniciado');
      }
      let chain = previous;
      if (!chain && input.messageType !== 'GENESIS') {
        throw new Error('audit chain missing GENESIS');
      }
      const previousSummaryHash = chain ? chain.summaryHash : null;
      const logHash = computeLogHash(input.eventData, input.salt);
      const summaryHash = computeSummaryHash(logHash, input.metadata, previousSummaryHash);
      const entry: AuditEntry = {
        id: input.id,
        messageType: input.messageType,
        eventData: input.eventData,
        metadata: input.metadata,
        salt: input.salt,
        logHash,
        summaryHash,
        previousSummaryHash,
        at: input.at,
        principal: input.principal,
      };
      entries.push(entry);
      return entry;
    },

    async redact(entryId) {
      const idx = entries.findIndex((e) => e.id === entryId);
      if (idx < 0) throw new Error(`entrada desconhecida: ${entryId}`);
      const e = entries[idx]!;
      if (e.messageType === 'GENESIS' || e.messageType === 'COMMIT') {
        throw new Error('não é possível redigir GENESIS/COMMIT');
      }
      const redacted: AuditEntry = {
        ...e,
        messageType: 'REDACTED',
        eventData: null,
        salt: null,
      };
      entries[idx] = redacted;
      return redacted;
    },

    async list() {
      return entries;
    },

    async head() {
      return entries[entries.length - 1];
    },

    async getById(entryId) {
      return entries.find((e) => e.id === entryId);
    },
  };
}
