/**
 * entity-resolution — tests/passo21.test.ts
 * Gate: toda decisão auditável; false merge reversível.
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenClusterScoringStrategy } from 'contracts';

import { runAuditDemo } from '../src/cli.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createEntityResolver } from '../src/core/engine.js';
import {
  fingerprintText,
  generateKGrams,
  hashKGram,
  slidingWindows,
  winnow,
} from '../src/core/fingerprint.js';

function er() {
  return createEntityResolver({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

const acmeA = {
  id: 'rec-A',
  objectTypeId: 'ot.customer',
  properties: { name: 'ACME LTDA', document: '12.345.678/0001-90' },
};
const acmeB = {
  id: 'rec-B',
  objectTypeId: 'ot.customer',
  properties: { name: 'Acme Ltda.', document: '12345678000190' },
};
const beta = {
  id: 'rec-C',
  objectTypeId: 'ot.customer',
  properties: { name: 'Beta Comercio ME', document: '98.765.432/0001-10' },
};

describe('Passo 21 — fingerprint (US 12,393,406)', () => {
  it('k-grams + winnow min hash, rightmost on ties', () => {
    const text = 'abcdefghij';
    const k = 5;
    const grams = generateKGrams(text, k);
    expect(grams).toEqual(['abcde', 'bcdef', 'cdefg', 'defgh', 'efghi', 'fghij']);
    const hashes = grams.map(hashKGram);
    const windows = slidingWindows(hashes, 4);
    expect(windows).toHaveLength(hashes.length - 4 + 1);
    const fp = winnow(hashes, 4);
    expect(fp.length).toBeGreaterThan(0);
    for (const p of fp) {
      expect(p.position).toBeGreaterThanOrEqual(0);
      expect(p.position).toBeLessThan(hashes.length);
      expect(p.hash).toBe(hashes[p.position]);
    }
    const again = fingerprintText(text, k, 4);
    expect(again).toEqual(fp);
  });

  it('winnow picks rightmost minimum when the window has duplicate mins', () => {
    const hashes = [9, 2, 2, 8];
    const fp = winnow(hashes, 4);
    expect(fp).toEqual([{ hash: 2, position: 2 }]);
  });
});

describe('Passo 21 — auditoria de matches', () => {
  it('commitRun persiste candidate/score/features/model/decision/reason/timestamp', async () => {
    const resolver = er();
    const result = resolver.runResolution({ records: [acmeA, acmeB, beta] });
    expect(result.candidates.length).toBeGreaterThan(0);
    await resolver.commitRun(result);
    const audit = await resolver.listMatchAudit({ runId: result.runId });
    expect(audit).toHaveLength(result.candidates.length);
    for (const row of audit) {
      expect(row.runId).toBe(result.runId);
      expect(row.modelVersion).toBe(result.ruleVersionId);
      expect(row.reason.length).toBeGreaterThan(0);
      expect(row.createdAt).toMatch(/^\d{4}-/);
      expect(row.features.propertyScores).toBeTruthy();
      expect(['match', 'no_match', 'review']).toContain(row.decision);
    }
    const reviewed = await resolver.recordReview({
      auditId: audit[0]!.id,
      decision: 'confirm_match',
      reviewer: 'analyst.1',
      note: 'same company',
    });
    expect(reviewed.review?.decision).toBe('confirm_match');
    expect(reviewed.review?.reviewer).toBe('analyst.1');
    const reloaded = await resolver.getMatchAudit(audit[0]!.id);
    expect(reloaded?.review?.decision).toBe('confirm_match');
  });
});

describe('Passo 21 — canonical merge reversível', () => {
  it('merge não destrói originais; unmerge desfaz o link', async () => {
    const resolver = er();
    const result = resolver.runResolution({ records: [acmeA, acmeB] });
    expect(result.normalized.map((n) => n.recordId).sort()).toEqual(['rec-A', 'rec-B']);
    await resolver.commitRun(result);

    const canonical = await resolver.mergeCanonical({
      objectTypeId: 'ot.customer',
      memberIds: ['rec-A', 'rec-B'],
      displayName: 'acme ltda',
      principal: 'analyst.1',
      reason: 'document exact',
    });
    expect(canonical.memberIds.sort()).toEqual(['rec-A', 'rec-B']);
    expect(canonical.version).toBe(1);

    const stillThere = resolver.runResolution({ records: [acmeA, acmeB] });
    expect(stillThere.normalized).toHaveLength(2);

    const linksA = await resolver.linksForRecord('rec-A');
    expect(linksA.some((l) => l.status === 'active' && l.canonicalId === canonical.id)).toBe(true);

    const after = await resolver.unmerge({
      canonicalId: canonical.id,
      recordId: 'rec-B',
      principal: 'analyst.1',
      reason: 'false merge',
    });
    expect(after?.memberIds).toEqual(['rec-A']);
    expect(after?.version).toBe(2);

    const linksB = await resolver.linksForRecord('rec-B');
    expect(linksB.some((l) => l.status === 'unmerged' && l.unmergeReason === 'false merge')).toBe(
      true,
    );
    expect(linksB.some((l) => l.status === 'active')).toBe(false);

    const events = await resolver.listMergeEvents(canonical.id);
    expect(events.map((e) => e.kind)).toEqual(['merge', 'unmerge']);
  });
});

describe('Passo 21 — ontology target compare + cluster rank', () => {
  it('compareToTargets confronta incoming com entidades já conhecidas', () => {
    const resolver = er();
    const result = resolver.compareToTargets(acmeB, [acmeA, beta]);
    expect(result.candidates.some((c) => c.decision === 'match')).toBe(true);
    const ranked = resolver.rankClusters(
      result.clusters,
      result.candidates,
      buildGoldenClusterScoringStrategy(),
    );
    expect(ranked[0]!.memberCount).toBeGreaterThanOrEqual(ranked[ranked.length - 1]!.memberCount);
    expect(ranked[0]!.seedId).toBeTruthy();
  });

  it('searchSimilar encontra ACME via fingerprint', async () => {
    const resolver = er();
    await resolver.indexFingerprints([acmeA, acmeB, beta]);
    const hits = await resolver.searchSimilar({
      id: 'q1',
      objectTypeId: 'ot.customer',
      properties: { name: 'ACME LTDA', document: '12345678000190' },
    });
    expect(hits.some((h) => h.recordId === 'rec-A' || h.recordId === 'rec-B')).toBe(true);
  });

  it('cli audit demo exit 0', async () => {
    const lines: string[] = [];
    expect(await runAuditDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('false merge reversível'))).toBe(true);
  });
});
