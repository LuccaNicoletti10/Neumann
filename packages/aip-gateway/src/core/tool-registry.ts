/**
 * aip-gateway — tool registry (read + optional propose; ADR-0022/0023).
 */

import type { AipActionPort, AipObjectReader, AipToolDefinition } from 'contracts';

export type AipToolHandler = (
  args: Record<string, unknown>,
  ctx: {
    principal: string;
    ontologyId: string;
    reads: AipObjectReader;
    actions?: AipActionPort;
  },
) => Promise<unknown>;

export interface RegisteredTool {
  def: AipToolDefinition;
  handler: AipToolHandler;
}

export interface CreateToolRegistryOptions {
  /** Passo 36 agent mode — allows riskLevel=propose. */
  allowPropose?: boolean;
}

export function createToolRegistry(opts: CreateToolRegistryOptions = {}) {
  const tools = new Map<string, RegisteredTool>();
  const allowPropose = opts.allowPropose === true;

  return {
    register(def: AipToolDefinition, handler: AipToolHandler): void {
      if (def.riskLevel === 'propose') {
        if (!allowPropose) {
          throw new Error(
            `AIP tool ${def.toolId}: riskLevel=propose requires allowPropose (agent mode)`,
          );
        }
      } else if (def.riskLevel !== 'read') {
        throw new Error(`AIP tool ${def.toolId}: unsupported riskLevel`);
      }
      if (tools.has(def.toolId)) {
        throw new Error(`AIP tool already registered: ${def.toolId}`);
      }
      tools.set(def.toolId, { def, handler });
    },
    list(): AipToolDefinition[] {
      return [...tools.values()].map((t) => t.def);
    },
    async invoke(
      toolId: string,
      args: Record<string, unknown>,
      ctx: {
        principal: string;
        ontologyId: string;
        reads: AipObjectReader;
        actions?: AipActionPort;
      },
    ): Promise<unknown> {
      const t = tools.get(toolId);
      if (!t) throw new Error(`AIP tool not found: ${toolId}`);
      const timeoutMs = t.def.timeoutMs > 0 ? t.def.timeoutMs : 5_000;
      return Promise.race([
        t.handler(args, ctx),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`AIP tool timeout: ${toolId} after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    },
  };
}

export type AipToolRegistry = ReturnType<typeof createToolRegistry>;

export function registerDefaultReadTools(registry: AipToolRegistry): void {
  registry.register(
    {
      toolId: 'list_object_types',
      description: 'List object type ids visible in the ontology',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'array', items: { type: 'string' } },
      requiredPermission: 'read:ontology',
      riskLevel: 'read',
      timeoutMs: 5_000,
    },
    async (_args, ctx) => ctx.reads.listObjectTypes(ctx.principal, ctx.ontologyId),
  );

  registry.register(
    {
      toolId: 'get_object',
      description: 'Get one object by type and primary key (redacted)',
      inputSchema: {
        type: 'object',
        properties: {
          objectTypeId: { type: 'string' },
          primaryKey: { type: 'string' },
        },
        required: ['objectTypeId', 'primaryKey'],
      },
      outputSchema: { type: 'object' },
      requiredPermission: 'read:object',
      riskLevel: 'read',
      timeoutMs: 5_000,
    },
    async (args, ctx) => {
      const objectTypeId = String(args.objectTypeId ?? '');
      const primaryKey = String(args.primaryKey ?? '');
      return ctx.reads.getObject(ctx.principal, ctx.ontologyId, objectTypeId, primaryKey);
    },
  );

  registry.register(
    {
      toolId: 'load_object_set',
      description: 'Load a page of objects of one type (redacted)',
      inputSchema: {
        type: 'object',
        properties: {
          objectTypeId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['objectTypeId'],
      },
      outputSchema: { type: 'array' },
      requiredPermission: 'read:object',
      riskLevel: 'read',
      timeoutMs: 10_000,
    },
    async (args, ctx) => {
      const objectTypeId = String(args.objectTypeId ?? '');
      const limit = Math.min(Number(args.limit ?? 20) || 20, 50);
      return ctx.reads.loadObjectSet(ctx.principal, ctx.ontologyId, objectTypeId, limit);
    },
  );

  registry.register(
    {
      toolId: 'graph_neighbors',
      description: 'List neighbors of an object via links',
      inputSchema: {
        type: 'object',
        properties: {
          objectTypeId: { type: 'string' },
          primaryKey: { type: 'string' },
          linkTypeId: { type: 'string' },
        },
        required: ['objectTypeId', 'primaryKey'],
      },
      outputSchema: { type: 'array' },
      requiredPermission: 'read:link',
      riskLevel: 'read',
      timeoutMs: 10_000,
    },
    async (args, ctx) => {
      const objectTypeId = String(args.objectTypeId ?? '');
      const primaryKey = String(args.primaryKey ?? '');
      const linkTypeId =
        typeof args.linkTypeId === 'string' && args.linkTypeId ? args.linkTypeId : undefined;
      return ctx.reads.graphNeighbors(
        ctx.principal,
        ctx.ontologyId,
        objectTypeId,
        primaryKey,
        linkTypeId,
      );
    },
  );
}

/** Passo 36 — validate/propose via ActionExecutor only. */
export function registerProposeTools(registry: AipToolRegistry): void {
  registry.register(
    {
      toolId: 'validate_action',
      description: 'Validate Action parameters without writing',
      inputSchema: {
        type: 'object',
        properties: {
          actionApiName: { type: 'string' },
          parameters: { type: 'object' },
        },
        required: ['actionApiName'],
      },
      outputSchema: { type: 'object' },
      requiredPermission: 'propose:action',
      riskLevel: 'propose',
      timeoutMs: 10_000,
    },
    async (args, ctx) => {
      if (!ctx.actions) throw new Error('validate_action: actions port required');
      return ctx.actions.validate({
        ontologyId: ctx.ontologyId,
        actionApiName: String(args.actionApiName ?? ''),
        parameters:
          args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters)
            ? (args.parameters as Record<string, unknown>)
            : {},
        principal: ctx.principal,
      });
    },
  );

  registry.register(
    {
      toolId: 'propose_action',
      description:
        'Apply Action via ActionExecutor (may pause AWAITING_APPROVAL). Sole mutation path.',
      inputSchema: {
        type: 'object',
        properties: {
          actionApiName: { type: 'string' },
          parameters: { type: 'object' },
          idempotencyKey: { type: 'string' },
        },
        required: ['actionApiName'],
      },
      outputSchema: { type: 'object' },
      requiredPermission: 'propose:action',
      riskLevel: 'propose',
      timeoutMs: 30_000,
    },
    async (args, ctx) => {
      if (!ctx.actions) throw new Error('propose_action: actions port required');
      const actionApiName = String(args.actionApiName ?? '');
      const parameters =
        args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters)
          ? (args.parameters as Record<string, unknown>)
          : {};
      const idempotencyKey =
        typeof args.idempotencyKey === 'string' && args.idempotencyKey
          ? args.idempotencyKey
          : undefined;
      return ctx.actions.apply({
        ontologyId: ctx.ontologyId,
        actionApiName,
        parameters,
        principal: ctx.principal,
        idempotencyKey,
      });
    },
  );
}
