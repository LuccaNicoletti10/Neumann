/**
 * connector-webhook — inbound webhook with HMAC signature check.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createDeterministicClock,
  createEventFactory,
  createIdGenerator,
  emptyState,
  mergeState,
  type ConnectorV2,
} from 'connector-sdk';

export function verifyWebhookSignature(raw: string, secret: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createWebhookConnector(opts: {
  secret: string;
  events?: Array<Record<string, unknown>>;
  connectorId?: string;
}): ConnectorV2 {
  const connectorId = opts.connectorId ?? 'webhook';
  const factory = createEventFactory({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
    defaultPrincipal: 'sa:webhook',
  });
  const events = opts.events ?? [];
  return {
    async spec() {
      return {
        connectorId,
        version: '1.0.0',
        configSchema: { type: 'object', properties: { secret: { type: 'string' } } },
      };
    },
    async check() {
      return { ok: Boolean(opts.secret), message: opts.secret ? undefined : 'missing secret' };
    },
    async discover() {
      return [{ name: 'events', sourceSystem: 'webhook' }];
    },
    async schema() {
      return {
        object: { sourceSystem: 'webhook', objectName: 'events' },
        columns: [{ name: 'id', dataType: 'string', nullable: false, isPrimaryKey: true }],
        schemaVersion: '1',
      };
    },
    async *read() {
      let state = emptyState();
      let i = 0;
      for (const rec of events) {
        i += 1;
        yield {
          type: 'RECORD' as const,
          record: factory.create({
            source_system: 'webhook',
            source_object: 'events',
            source_primary_key: String(rec.id ?? i),
            schema_version: '1',
            connector_id: connectorId,
            checkpoint: String(i),
            principal: 'sa:webhook',
            payload: rec,
          }),
        };
        state = mergeState(state, 'events', { token: String(i) });
      }
      yield { type: 'STATE' as const, state };
    },
  };
}
