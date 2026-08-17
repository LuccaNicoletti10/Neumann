/**
 * connector-csv — full-refresh CSV file connector (v2 protocol).
 */
import { readFileSync } from 'node:fs';
import type { CanonicalEvent } from 'contracts';
import {
  createDeterministicClock,
  createEventFactory,
  createIdGenerator,
  emptyState,
  mergeState,
  type ConnectorV2,
} from 'connector-sdk';

export function createCsvConnector(opts: { path: string; connectorId?: string }): ConnectorV2 {
  const connectorId = opts.connectorId ?? 'csv';
  const factory = createEventFactory({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
    defaultPrincipal: 'sa:csv',
  });
  function rows(): Record<string, string>[] {
    const text = readFileSync(opts.path, 'utf8').trim();
    const [header, ...lines] = text.split(/\r?\n/);
    const cols = header!.split(',').map((c) => c.trim());
    return lines.map((line) => {
      const vals = line.split(',');
      const rec: Record<string, string> = {};
      cols.forEach((c, i) => {
        rec[c] = (vals[i] ?? '').trim();
      });
      return rec;
    });
  }
  return {
    async spec() {
      return {
        connectorId,
        version: '1.0.0',
        configSchema: { type: 'object', properties: { path: { type: 'string' } } },
      };
    },
    async check() {
      try {
        rows();
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    async discover() {
      return [{ name: 'csv', sourceSystem: 'file' }];
    },
    async schema() {
      const first = rows()[0] ?? {};
      return {
        object: { sourceSystem: 'file', objectName: 'csv' },
        columns: Object.keys(first).map((name) => ({
          name,
          dataType: 'string',
          nullable: true,
          isPrimaryKey: name === 'id',
        })),
        schemaVersion: '1',
      };
    },
    async *read() {
      const data = rows();
      let i = 0;
      let state = emptyState();
      for (const rec of data) {
        i += 1;
        const tags =
          rec.classification && rec.classification.length > 0
            ? [`classification:${rec.classification}`]
            : [];
        const event: CanonicalEvent = factory.create({
          source_system: 'file',
          source_object: 'csv',
          source_primary_key: rec.id ?? String(i),
          schema_version: '1',
          connector_id: connectorId,
          checkpoint: String(i),
          principal: 'sa:csv',
          policy_tags: tags,
          payload: rec,
        });
        yield { type: 'RECORD' as const, record: event };
        state = mergeState(state, 'csv', { token: String(i) });
      }
      yield { type: 'STATE' as const, state };
    },
  };
}
