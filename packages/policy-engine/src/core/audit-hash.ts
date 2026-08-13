/**
 * policy-engine — src/core/audit-hash.ts
 * Hash-chain primitives shared by memory and PostgreSQL audit repositories.
 */

import type { AuditEntry, AuditVerifyResult } from 'contracts';

import { sha256Hex } from './hash.js';

export function computeLogHash(eventData: string | null, salt: string | null): string {
  return sha256Hex([eventData ?? 'REDACTED', salt ?? '']);
}

export function computeSummaryHash(
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

export function verifyEntries(entries: readonly AuditEntry[]): AuditVerifyResult {
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
