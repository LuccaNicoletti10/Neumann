/**
 * event-bus — HttpWritebackConnector
 * Always sends Idempotency-Key: neumann:<outboxEventId>.
 */

import { createHash } from 'node:crypto';

import type { WritebackConnector, WritebackRequest, WritebackResult } from './types.js';

export interface HttpWritebackRequestPlan {
  url: string;
  method: string;
  body: unknown;
}

export interface CreateHttpWritebackConnectorOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  buildRequest?: (req: WritebackRequest) => HttpWritebackRequestPlan;
}

function defaultPlan(baseUrl: string, req: WritebackRequest): HttpWritebackRequestPlan {
  const root = baseUrl.replace(/\/$/, '');
  const payload = req.payload;
  const params =
    payload.params && typeof payload.params === 'object'
      ? (payload.params as Record<string, unknown>)
      : payload;
  const orderId = params.orderId ?? params.id;
  if (req.operation === 'update' && typeof orderId === 'string') {
    return {
      url: `${root}/orders/${encodeURIComponent(orderId)}`,
      method: 'PATCH',
      body: params,
    };
  }
  if (req.operation === 'create') {
    return { url: `${root}/orders`, method: 'POST', body: params };
  }
  return { url: `${root}/writebacks`, method: 'POST', body: payload };
}

export function createHttpWritebackConnector(
  opts: CreateHttpWritebackConnectorOptions,
): WritebackConnector {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return {
    kind: 'http',
    async execute(req: WritebackRequest): Promise<WritebackResult> {
      const plan = opts.buildRequest?.(req) ?? defaultPlan(opts.baseUrl, req);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(plan.url, {
          method: plan.method,
          headers: {
            'content-type': 'application/json',
            'idempotency-key': req.idempotencyKey,
            'x-trace-id': req.traceId,
            'x-neumann-event-id': req.eventId,
            'x-neumann-attempt': String(req.attempt),
          },
          body: JSON.stringify(plan.body),
          signal: ctrl.signal,
        });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        const ok = res.status >= 200 && res.status < 300;
        const responseHash = createHash('sha256').update(text).digest('hex');
        const externalId =
          parsed && typeof parsed === 'object' && parsed !== null && 'id' in parsed
            ? String((parsed as { id: unknown }).id)
            : undefined;
        const result: WritebackResult = {
          ok,
          statusCode: res.status,
          responseHash,
          responseMetadata: {
            url: plan.url,
            method: plan.method,
            body: parsed,
          },
        };
        if (externalId) result.externalId = externalId;
        if (!ok) {
          result.error = `HTTP ${res.status}`;
          result.retryable = res.status === 429 || res.status >= 500;
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: message,
          retryable: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
