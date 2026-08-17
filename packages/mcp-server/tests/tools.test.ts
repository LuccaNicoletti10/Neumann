import { describe, expect, it } from 'vitest';

import type { ActionTypeDef } from 'contracts';

import { actionToJsonSchema } from '../src/schema-gen.js';
import { applyAction, type ToolContext } from '../src/tools/platform.js';
import { createMcpServer } from '../src/server.js';

describe('mcp-server schema-gen', () => {
  it('maps each baseType', () => {
    const def: ActionTypeDef = {
      id: 'act.x',
      displayName: 'X',
      inputObjectTypeIds: [],
      parameters: {
        n: { baseType: 'number', required: true },
        s: { baseType: 'string', required: false },
        b: { baseType: 'boolean' },
        d: { baseType: 'datetime' },
        o: { baseType: 'object_reference', objectTypeId: 'ot.order' },
      },
    };
    const schema = actionToJsonSchema(def);
    const props = schema.properties as Record<string, { type: string }>;
    expect(props.n?.type).toBe('number');
    expect(props.s?.type).toBe('string');
    expect(props.b?.type).toBe('boolean');
    expect(props.d?.type).toBe('string');
    expect(props.o?.type).toBe('string');
    expect(schema.required).toEqual(['n', 'b', 'd', 'o']);
  });
});

describe('mcp-server tools', () => {
  it('apply_action is blocked without --enable-mutations', async () => {
    const ctx: ToolContext = {
      client: { get: async () => ({}), post: async () => ({ status: 'SUCCEEDED' }) },
      ontologyId: 'o1',
      enableMutations: false,
    };
    const r = await applyAction(ctx, 'approve', {});
    expect(r).toMatchObject({ error: expect.stringMatching(/enable-mutations/) });
  });

  it('dispatch apply_action with flag hits client; repeated idempotencyKey is forwarded', async () => {
    const posts: unknown[] = [];
    const server = createMcpServer({
      baseUrl: 'http://unused',
      token: 't',
      ontologyId: 'o1',
      enableMutations: true,
    });
    server.client.post = async (_p, body) => {
      posts.push(body);
      return { executionId: 'aex-1', status: 'SUCCEEDED' };
    };
    const a = await server.dispatch('apply_action', {
      action: 'approve',
      parameters: { orderId: '1' },
      idempotencyKey: 'k1',
    });
    const b = await server.dispatch('apply_action', {
      action: 'approve',
      parameters: { orderId: '1' },
      idempotencyKey: 'k1',
    });
    expect(a).toEqual(b);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ idempotencyKey: 'k1' });
  });

  it('search_objects forwards ObjectSet FILTER', async () => {
    const posts: unknown[] = [];
    const server = createMcpServer({
      baseUrl: 'http://unused',
      token: 't',
      ontologyId: 'o1',
    });
    server.client.post = async (_p, body) => {
      posts.push(body);
      return { data: [] };
    };
    const objectSet = { type: 'FILTER', objectType: 'ot.cliente', where: { type: 'EQ', field: 'id', value: '1' } };
    await server.dispatch('search_objects', { objectSet });
    expect(posts[0]).toMatchObject({ objectSet });
  });

  it('token without grant surfaces deny status', async () => {
    const server = createMcpServer({
      baseUrl: 'http://unused',
      token: 't',
      ontologyId: 'o1',
    });
    server.client.get = async () => ({ error: 'forbidden', status: 403 });
    const r = await server.dispatch('list_object_types', {});
    expect(r).toMatchObject({ error: 'forbidden', status: 403 });
  });

  it('platform down returns structured 503', async () => {
    const server = createMcpServer({
      baseUrl: 'http://127.0.0.1:1',
      token: 't',
      ontologyId: 'o1',
    });
    const r = await server.dispatch('list_object_types', {});
    expect(r).toMatchObject({ status: 503, error: expect.any(String) });
  });
});

describe('official MCP SDK', () => {
  it('stdio in-memory client lists tools and blocks apply without flag', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createOfficialMcpServer } = await import('../src/mcp.js');
    const server = createOfficialMcpServer({
      baseUrl: 'http://unused',
      token: 't',
      ontologyId: 'o1',
      enableMutations: false,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'apply_action',
      'get_object',
      'list_actions',
      'list_object_types',
      'search_objects',
    ]);
    const applied = await client.callTool({
      name: 'apply_action',
      arguments: { action: 'approve', parameters: {} },
    });
    const text = (applied.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/enable-mutations/);
    await client.close();
    await server.close();
  });

  it('streamable HTTP lists tools', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    const { createMcpHttpServer } = await import('../src/http.js');
    const httpServer = createMcpHttpServer({
      baseUrl: 'http://unused',
      token: 't',
      ontologyId: 'o1',
      enableMutations: false,
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('list_object_types');
    await client.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
