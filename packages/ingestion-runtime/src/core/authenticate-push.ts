/**
 * ingestion-runtime — webhook HMAC. Runtime must not import a connector package.
 * Signed payload is timestamp + "." + nonce + "." + rawBody (ADR-0017).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebhookAuthenticationError, WebhookTimestampError } from './errors.js';

export interface SecretResolver {
  get(key: string): Promise<string | undefined>;
}

export function createMemorySecretResolver(
  initial: Record<string, string> = {},
): SecretResolver & { set(key: string, value: string): void } {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.get(key);
    },
    set(key, value) {
      map.set(key, value);
    },
  };
}

export function webhookSecretKey(connectorId: string): string {
  return `connector:${connectorId}:webhook-secret`;
}

export function webhookSignedPayload(timestamp: string, nonce: string, rawBody: string): string {
  return `${timestamp}.${nonce}.${rawBody}`;
}

export function verifyHmacSha256(raw: string, secret: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseWebhookTimestamp(timestamp: string): number {
  if (/^\d+$/.test(timestamp)) {
    const n = Number(timestamp);
    return timestamp.length <= 10 ? n * 1000 : n;
  }
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) throw new WebhookTimestampError('webhook timestamp invalid');
  return ms;
}

export async function authenticateWebhook(input: {
  rawBody: string;
  signature: string;
  timestamp: string;
  nonce: string;
  secret: string;
  nowMs: number;
  maxSkewMs: number;
}): Promise<void> {
  if (!input.timestamp) throw new WebhookAuthenticationError('webhook timestamp missing');
  if (!input.nonce) throw new WebhookAuthenticationError('webhook nonce missing');
  if (!input.signature) throw new WebhookAuthenticationError('webhook signature missing');
  const ts = parseWebhookTimestamp(input.timestamp);
  if (Math.abs(input.nowMs - ts) > input.maxSkewMs) {
    throw new WebhookTimestampError();
  }
  const signed = webhookSignedPayload(input.timestamp, input.nonce, input.rawBody);
  if (!verifyHmacSha256(signed, input.secret, input.signature)) {
    throw new WebhookAuthenticationError('webhook signature mismatch');
  }
}
