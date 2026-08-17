/**
 * connector-http — paginated REST connector (v2).
 */
import {
  createDeterministicClock,
  createEventFactory,
  createIdGenerator,
  emptyState,
  mergeState,
  type ConnectorV2,
} from 'connector-sdk';

export function createHttpConnector(opts: {
  url: string;
  connectorId?: string;
  fetchImpl?: typeof fetch;
}): ConnectorV2 {
  const connectorId = opts.connectorId ?? 'http';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const factory = createEventFactory({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
    defaultPrincipal: 'sa:http',
  });
  return {
    async spec() {
      return {
        connectorId,
        version: '1.0.0',
        configSchema: { type: 'object', properties: { url: { type: 'string' } } },
      };
    },
    async check() {
      try {
        const res = await fetchImpl(opts.url);
        return { ok: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    async discover() {
      return [{ name: 'items', sourceSystem: 'http' }];
    },
    async schema() {
      return {
        object: { sourceSystem: 'http', objectName: 'items' },
        columns: [{ name: 'id', dataType: 'string', nullable: false, isPrimaryKey: true }],
        schemaVersion: '1',
      };
    },
    async *read() {
      const res = await fetchImpl(opts.url);
      if (!res.ok) {
        yield { type: 'ERROR' as const, message: `HTTP ${res.status}` };
        return;
      }
      const body = (await res.json()) as unknown;
      const items = Array.isArray(body)
        ? body
        : Array.isArray((body as { data?: unknown }).data)
          ? ((body as { data: unknown[] }).data)
          : [body];
      let state = emptyState();
      let i = 0;
      for (const item of items) {
        i += 1;
        const rec = (item ?? {}) as Record<string, unknown>;
        yield {
          type: 'RECORD' as const,
          record: factory.create({
            source_system: 'http',
            source_object: 'items',
            source_primary_key: String(rec.id ?? i),
            schema_version: '1',
            connector_id: connectorId,
            checkpoint: String(i),
            principal: 'sa:http',
            payload: rec,
          }),
        };
        state = mergeState(state, 'items', { token: String(i) });
      }
      yield { type: 'STATE' as const, state };
    },
  };
}
