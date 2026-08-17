/**
 * platform-api — src/routes/er.ts
 * Passo 22 — fila de revisão + gold set + métricas (US20250165857A1).
 */

import type { FastifyInstance } from 'fastify';
import type {
  EntityRecord,
  RecordReviewInput,
  ReviewDecision,
  UpsertGoldPairInput,
} from 'contracts';

import type { PlatformContext } from '../core/context.js';
import { principalOf } from '../core/principal.js';

export async function registerErRoutes(
  app: FastifyInstance,
  ctx: PlatformContext,
): Promise<void> {
  app.get<{ Querystring: { runId?: string } }>(
    '/api/v2/er/review-queue',
    async (req) => {
      const data = await ctx.er.listReviewQueue(req.query.runId);
      return { data };
    },
  );

  app.post<{
    Body: { auditId: string; decision: ReviewDecision; note?: string };
  }>('/api/v2/er/review', async (req, reply) => {
    const body = req.body ?? ({} as { auditId: string; decision: ReviewDecision; note?: string });
    if (!body.auditId || !body.decision) {
      return reply.code(400).send({ error: 'auditId and decision required' });
    }
    const input: RecordReviewInput = {
      auditId: body.auditId,
      decision: body.decision,
      reviewer: principalOf(req),
      note: body.note,
    };
    const result = await ctx.er.submitReview(input);
    return reply.code(200).send(result);
  });

  app.get('/api/v2/er/gold-set', async () => {
    return ctx.er.getGoldSet();
  });

  app.post<{ Body: { pairs?: UpsertGoldPairInput[] } }>(
    '/api/v2/er/gold-set',
    async (req, reply) => {
      const pairs = req.body?.pairs ?? [];
      const labeledBy = principalOf(req);
      const gold = await ctx.er.upsertGoldPairs(
        pairs.map((p) => ({ ...p, labeledBy: p.labeledBy || labeledBy })),
      );
      return reply.code(200).send(gold);
    },
  );

  app.get<{ Querystring: { runId?: string } }>(
    '/api/v2/er/metrics',
    async (req) => {
      return ctx.er.evaluateMetrics(req.query.runId);
    },
  );

  app.post('/api/v2/er/feedback', async () => {
    return ctx.er.applyFeedback();
  });

  app.post<{ Body: { records?: EntityRecord[] } }>(
    '/api/v2/er/runs',
    async (req, reply) => {
      const records = req.body?.records ?? [];
      if (records.length === 0) {
        return reply.code(400).send({ error: 'records required' });
      }
      const result = ctx.er.runResolution({ records });
      await ctx.er.commitRun(result);
      return reply.code(201).send({
        runId: result.runId,
        stats: result.stats,
        candidateCount: result.candidates.length,
      });
    },
  );
}
