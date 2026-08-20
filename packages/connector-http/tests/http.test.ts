/**
 * connector-http — injected transport + local server. No external network.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createHttpConnector } from '../src/index.js';

async function collect(connector: ReturnType<typeof createHttpConnector>) {
  const records: Array<{ id: unknown }> = [];
  const errors: string[] = [];
  const states: unknown[] = [];
  for await (const msg of connector.read({ fullRefresh: true })) {
    if (msg.type === 'RECORD') {
      records.push(msg.record.payload as { id: unknown });
    }
    if (msg.type === 'ERROR') errors.push(msg.message);
    if (msg.type === 'STATE') states.push(msg.state);
  }
  return { records, errors, states };
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}/items`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('createHttpConnector', () => {
  it('reads a valid JSON array from an injected transport', async () => {
    const connector = createHttpConnector({
      url: 'http://connector-http.test/items',
      fetchImpl: async () =>
        new Response(JSON.stringify([{ id: 'a' }, { id: 'b' }]), { status: 200 }),
    });
    const check = await connector.check();
    expect(check.ok).toBe(true);
    const { records, errors, states } = await collect(connector);
    expect(errors).toEqual([]);
    expect(records).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(states).toHaveLength(1);
  });

  it('wraps `{ data: [] }` pagination payloads', async () => {
    const connector = createHttpConnector({
      url: 'http://connector-http.test/items',
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: 'p1' }] }), { status: 200 }),
    });
    const { records } = await collect(connector);
    expect(records).toEqual([{ id: 'p1' }]);
  });

  it('emits ERROR on HTTP 500', async () => {
    const connector = createHttpConnector({
      url: 'http://connector-http.test/items',
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    const check = await connector.check();
    expect(check.ok).toBe(false);
    expect(check.message).toBe('HTTP 500');
    const { records, errors } = await collect(connector);
    expect(records).toEqual([]);
    expect(errors).toEqual(['HTTP 500']);
  });

  it('reads from a local HTTP server', async () => {
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'local-1' }]));
    });
    try {
      const connector = createHttpConnector({ url: server.url });
      const { records, errors } = await collect(connector);
      expect(errors).toEqual([]);
      expect(records).toEqual([{ id: 'local-1' }]);
    } finally {
      await server.close();
    }
  });
});
