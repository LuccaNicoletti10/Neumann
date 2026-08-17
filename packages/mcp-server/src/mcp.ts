/**
 * mcp-server — official MCP SDK server (tools over platform-api HTTP).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createMcpServer, type CreateMcpServerOptions } from './server.js';

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

export function createOfficialMcpServer(opts: CreateMcpServerOptions): McpServer {
  const inner = createMcpServer(opts);
  const server = new McpServer({ name: 'neumann', version: '1.0.0' });

  server.tool('list_object_types', 'List object types in the ontology', async () =>
    textResult(await inner.dispatch('list_object_types', {})),
  );
  server.tool(
    'get_object',
    'Get one object by type and primary key',
    { objectType: z.string(), primaryKey: z.string() },
    async (args) => textResult(await inner.dispatch('get_object', args)),
  );
  server.tool(
    'search_objects',
    'Search objects with an ObjectSet FILTER',
    {
      objectType: z.string().optional(),
      objectSet: z.record(z.unknown()).optional(),
    },
    async (args) => textResult(await inner.dispatch('search_objects', args)),
  );
  server.tool('list_actions', 'List action types', async () =>
    textResult(await inner.dispatch('list_actions', {})),
  );
  server.tool(
    'apply_action',
    'Apply an action (requires --enable-mutations)',
    {
      action: z.string(),
      parameters: z.record(z.unknown()).optional(),
      idempotencyKey: z.string().optional(),
    },
    async (args) => textResult(await inner.dispatch('apply_action', args)),
  );
  return server;
}
