/**
 * platform-api — ER review queue + gold metrics (Passo 22).
 */
import { describe, expect, it } from 'vitest';
import { buildPasso22GoldCorpus } from 'entity-resolution';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('Passo 22 — ER review HTTP', () => {
  it('GET review-queue + POST review + GET metrics', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const corpus = buildPasso22GoldCorpus();
    const result = ctx.er.runResolution({ records: corpus.records });
    await ctx.er.commitRun(result);
    await ctx.er.upsertGoldPairs(
      corpus.labels.map((l) => ({
        leftId: l.leftId,
        rightId: l.rightId,
        label: l.label,
        labeledBy: 'gold-analyst',
      })),
    );

    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });
    const token = signDevToken({ secret: SECRET, principal: 'svc-projector' });
    const headers = { authorization: `Bearer ${token}` };

    const queueRes = await app.inject({
      method: 'GET',
      url: `/api/v2/er/review-queue?runId=${result.runId}`,
      headers,
    });
    expect(queueRes.statusCode).toBe(200);
    const queue = queueRes.json() as { data: Array<{ auditId: string; decision: string }> };
    expect(Array.isArray(queue.data)).toBe(true);
    expect(queue.data.every((q) => q.decision === 'review')).toBe(true);

    if (queue.data[0]) {
      const reviewed = await app.inject({
        method: 'POST',
        url: '/api/v2/er/review',
        headers,
        payload: {
          auditId: queue.data[0].auditId,
          decision: 'confirm_match',
          note: 'human',
        },
      });
      expect(reviewed.statusCode).toBe(200);
      expect(reviewed.json().audit?.review?.decision).toBe('confirm_match');
    }

    const metricsRes = await app.inject({
      method: 'GET',
      url: `/api/v2/er/metrics?runId=${result.runId}`,
      headers,
    });
    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.json() as {
      goldPairCount: number;
      falseMergeNote: string;
      f1: number;
    };
    expect(metrics.goldPairCount).toBe(50);
    expect(metrics.falseMergeNote).toMatch(/false-merge-rate/);
    expect(Number.isFinite(metrics.f1)).toBe(true);

    const goldRes = await app.inject({
      method: 'GET',
      url: '/api/v2/er/gold-set',
      headers,
    });
    expect(goldRes.statusCode).toBe(200);
    expect(goldRes.json().pairs).toHaveLength(50);

    await app.close();
  });
});
