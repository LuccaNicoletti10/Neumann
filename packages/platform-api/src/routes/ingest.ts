/**
 * Thin HTTP adapter for webhook ingest (ADR-0017).
 * Calls only ctx.ingestion.enqueueWebhook. No repositories. No mutation writer.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { declareHmacIngress } from '../core/route-policy.js';
import type { PlatformContext } from '../core/context.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

function header(req: FastifyRequest, name: string): string {
  const value = req.headers[name];
  return typeof value === 'string' ? value : '';
}

function maxBodyBytes(): number {
  const raw = process.env.INGEST_MAX_BODY_BYTES;
  const n = raw ? Number(raw) : 1_048_576;
  return Number.isFinite(n) && n > 0 ? n : 1_048_576;
}

export async function registerIngestRoutes(app: FastifyInstance, ctx: PlatformContext): Promise<void> {
  const limit = maxBodyBytes();
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: limit },
      (req, body, done) => {
        const raw = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
        req.rawBody = raw;
        try {
          done(null, JSON.parse(raw) as unknown);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
    scope.post<{ Params: { connectorId: string } }>(
      '/api/v2/ingest/:connectorId',
      {
        ...declareHmacIngress(),
        bodyLimit: limit,
      },
      async (req, reply) => {
        const rawBody = req.rawBody ?? '';
        const accepted = await ctx.ingestion.enqueueWebhook({
          connectorId: req.params.connectorId,
          rawBody,
          signature: header(req, 'x-neumann-signature'),
          timestamp: header(req, 'x-neumann-timestamp'),
          nonce: header(req, 'x-neumann-nonce'),
        });
        return reply.code(202).send({
          runId: accepted.id,
          sourceEventId: accepted.sourceEventId,
          status: accepted.replayed ? 'replayed' : 'accepted',
        });
      },
    );
  });
}
