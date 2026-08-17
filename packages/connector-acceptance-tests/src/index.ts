/**
 * connector-acceptance-tests — CAT every connector must pass.
 */
import type { ConnectorV2 } from 'connector-sdk';

export interface CatResult {
  ok: boolean;
  errors: string[];
}

export async function runConnectorAcceptanceTests(connector: ConnectorV2): Promise<CatResult> {
  const errors: string[] = [];
  try {
    const spec = await connector.spec();
    if (!spec.connectorId || !spec.version) errors.push('spec missing connectorId/version');
  } catch (err) {
    errors.push(`spec: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const check = await connector.check();
    if (!check.ok) errors.push(`check failed: ${check.message ?? 'unknown'}`);
  } catch (err) {
    errors.push(`check: ${err instanceof Error ? err.message : String(err)}`);
  }
  let streams: Awaited<ReturnType<ConnectorV2['discover']>> = [];
  try {
    streams = await connector.discover();
    if (streams.length < 1) errors.push('discover returned 0 streams');
  } catch (err) {
    errors.push(`discover: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (streams[0]) {
    try {
      const records: unknown[] = [];
      let stateCount = 0;
      for await (const msg of connector.read({ fullRefresh: true })) {
        if (msg.type === 'RECORD') records.push(msg.record);
        if (msg.type === 'STATE') stateCount += 1;
        if (msg.type === 'ERROR') errors.push(`read: ${msg.message}`);
      }
      if (records.length === 0) errors.push('read full-refresh produced 0 records');
      const again: unknown[] = [];
      for await (const msg of connector.read({ fullRefresh: true })) {
        if (msg.type === 'RECORD') again.push(msg.record);
      }
      if (again.length !== records.length) {
        errors.push('schema/read not stable between runs');
      }
      void stateCount;
    } catch (err) {
      errors.push(`read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
