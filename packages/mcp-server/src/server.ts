/**
 * mcp-server — stdio JSON-RPC loop (MCP-shaped) over HTTP platform-api.
 */
import { actionToJsonSchema } from './schema-gen.js';
import {
  applyAction,
  getObject,
  listActions,
  listObjectTypes,
  searchObjects,
  type McpPlatformClient,
} from './tools/platform.js';

export interface CreateMcpServerOptions {
  baseUrl: string;
  token: string;
  ontologyId: string;
  enableMutations?: boolean;
}

export function createPlatformClient(baseUrl: string, token: string): McpPlatformClient {
  const root = baseUrl.replace(/\/$/, '');
  async function call(method: string, path: string, body?: unknown) {
    try {
      const res = await fetch(`${root}/api/v2${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          error: (json as { message?: string }).message ?? `HTTP ${res.status}`,
          status: res.status,
        };
      }
      return json;
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'platform unreachable',
        status: 503,
      };
    }
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
  };
}

export function createMcpServer(opts: CreateMcpServerOptions) {
  const client = createPlatformClient(opts.baseUrl, opts.token);
  const ctx = {
    client,
    ontologyId: opts.ontologyId,
    enableMutations: opts.enableMutations === true,
  };
  return {
    client,
    schema: actionToJsonSchema,
    async dispatch(tool: string, args: Record<string, unknown>) {
      switch (tool) {
        case 'list_object_types':
          return listObjectTypes(ctx);
        case 'get_object':
          return getObject(ctx, String(args.objectType), String(args.primaryKey));
        case 'search_objects':
          return searchObjects(ctx, (args.objectSet as Record<string, unknown>) ?? { type: 'BASE', objectType: String(args.objectType ?? '') });
        case 'list_actions':
          return listActions(ctx);
        case 'apply_action':
          return applyAction(
            ctx,
            String(args.action),
            (args.parameters as Record<string, unknown>) ?? {},
            args.idempotencyKey ? String(args.idempotencyKey) : undefined,
          );
        default:
          return { error: `unknown tool: ${tool}` };
      }
    },
  };
}

export { actionToJsonSchema } from './schema-gen.js';
