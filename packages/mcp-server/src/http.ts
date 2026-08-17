#!/usr/bin/env node
/**
 * mcp-server — Streamable HTTP transport (official SDK).
 * Env: NEUMANN_API_URL, NEUMANN_TOKEN, NEUMANN_ONTOLOGY, MCP_HTTP_PORT (default 3100)
 * Flag: --enable-mutations
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createOfficialMcpServer } from './mcp.js';
import type { CreateMcpServerOptions } from './server.js';

export function createMcpHttpServer(opts: CreateMcpServerOptions) {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    const sessionHeader = req.headers['mcp-session-id'];
    const sessionId = typeof sessionHeader === 'string' ? sessionHeader : undefined;
    const existing = sessionId === undefined ? undefined : sessions.get(sessionId);
    if (existing !== undefined) {
      await existing.handleRequest(req, res);
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });
    const server = createOfficialMcpServer(opts);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(
          JSON.stringify({ error: err instanceof Error ? err.message : 'mcp http error' }),
        );
      }
    });
  });
}

function isDirectRun(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && (invoked.endsWith('http.ts') || invoked.endsWith('http.js'));
}

if (isDirectRun()) {
  const enableMutations = process.argv.includes('--enable-mutations');
  const port = Number(process.env.MCP_HTTP_PORT ?? '3100');
  const httpServer = createMcpHttpServer({
    baseUrl: process.env.NEUMANN_API_URL ?? 'http://127.0.0.1:3000',
    token: process.env.NEUMANN_TOKEN ?? '',
    ontologyId: process.env.NEUMANN_ONTOLOGY ?? 'default',
    enableMutations,
  });
  httpServer.listen(port, '127.0.0.1', () => {
    process.stderr.write(`neumann-mcp http://127.0.0.1:${port}/mcp\n`);
  });
}
