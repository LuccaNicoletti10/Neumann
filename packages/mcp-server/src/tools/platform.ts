/**
 * mcp-server — HTTP client tools over /api/v2. Mutations require --enable-mutations.
 */
export interface McpPlatformClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export interface ToolContext {
  client: McpPlatformClient;
  ontologyId: string;
  enableMutations: boolean;
}

export async function listObjectTypes(ctx: ToolContext) {
  return ctx.client.get(`/ontologies/${ctx.ontologyId}/objectTypes`).catch(async () => {
    const v = (await ctx.client.get(`/ontologies/${ctx.ontologyId}`)) as { objectTypes?: unknown };
    return v;
  });
}

export async function getObject(ctx: ToolContext, objectType: string, primaryKey: string) {
  return ctx.client.get(`/ontologies/${ctx.ontologyId}/objects/${objectType}/${primaryKey}`);
}

export async function searchObjects(ctx: ToolContext, objectSet: Record<string, unknown>) {
  return ctx.client.post(`/ontologies/${ctx.ontologyId}/objectSets/loadObjects`, {
    objectSet,
    pageSize: 50,
  });
}

export async function listActions(ctx: ToolContext) {
  return ctx.client.get(`/ontologies/${ctx.ontologyId}/actionTypes`);
}

export async function applyAction(
  ctx: ToolContext,
  action: string,
  parameters: Record<string, unknown>,
  idempotencyKey?: string,
) {
  if (!ctx.enableMutations) {
    return { error: 'apply_action disabled (pass --enable-mutations)' };
  }
  return ctx.client.post(`/ontologies/${ctx.ontologyId}/actions/${action}/apply`, {
    parameters,
    idempotencyKey,
  });
}
