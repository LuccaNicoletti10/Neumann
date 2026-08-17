#!/usr/bin/env node
/**
 * mcp-server — stdio transport (official SDK).
 * Env: NEUMANN_API_URL, NEUMANN_TOKEN, NEUMANN_ONTOLOGY
 * Flag: --enable-mutations
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createOfficialMcpServer } from './mcp.js';

const enableMutations = process.argv.includes('--enable-mutations');
const server = createOfficialMcpServer({
  baseUrl: process.env.NEUMANN_API_URL ?? 'http://127.0.0.1:3000',
  token: process.env.NEUMANN_TOKEN ?? '',
  ontologyId: process.env.NEUMANN_ONTOLOGY ?? 'default',
  enableMutations,
});

await server.connect(new StdioServerTransport());
