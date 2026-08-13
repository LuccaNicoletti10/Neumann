/**
 * ERP simulator — intentional test double, not SAP/TOTVS/Omie.
 *
 * Faults via header X-Simulate-Fault:
 *   500 | 429 | timeout | latency:<ms> | reset | duplicate
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

export interface ErpOrder {
  id: string;
  status: string;
  quantity?: number;
  customerId?: string;
  [key: string]: unknown;
}

export interface ErpInventory {
  sku: string;
  quantity: number;
}

export interface ErpSupplier {
  id: string;
  name: string;
  status: string;
}

export interface ErpSimulatorState {
  orders: Map<string, ErpOrder>;
  inventory: Map<string, ErpInventory>;
  suppliers: Map<string, ErpSupplier>;
  idempotency: Map<string, { statusCode: number; body: unknown }>;
  writebacks: number;
}

export interface CreateErpSimulatorOptions {
  seed?: (state: ErpSimulatorState) => void;
}

function faultOf(req: FastifyRequest): string | undefined {
  const h = req.headers['x-simulate-fault'];
  if (typeof h === 'string' && h.trim()) return h.trim().toLowerCase();
  const q = (req.query as Record<string, unknown> | undefined)?.fault;
  return typeof q === 'string' ? q.toLowerCase() : undefined;
}

export function createErpSimulator(opts: CreateErpSimulatorOptions = {}): {
  app: FastifyInstance;
  state: ErpSimulatorState;
} {
  const state: ErpSimulatorState = {
    orders: new Map(),
    inventory: new Map(),
    suppliers: new Map(),
    idempotency: new Map(),
    writebacks: 0,
  };
  opts.seed?.(state);

  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (req, reply) => {
    const fault = faultOf(req);
    if (!fault) return;
    if (fault === '500') {
      return reply.code(500).send({ error: 'simulated_500' });
    }
    if (fault === '429') {
      return reply.code(429).send({ error: 'simulated_429' });
    }
    if (fault === 'timeout') {
      await new Promise((r) => setTimeout(r, 60_000));
      return;
    }
    if (fault.startsWith('latency:')) {
      const ms = Number(fault.slice('latency:'.length));
      if (Number.isFinite(ms) && ms > 0) await new Promise((r) => setTimeout(r, ms));
    }
    if (fault === 'reset') {
      req.raw.destroy();
      return reply;
    }
    if (fault === 'duplicate') {
      return reply.code(409).send({ error: 'simulated_duplicate' });
    }
  });

  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET') return;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) return;
    const cached = state.idempotency.get(key);
    if (cached) {
      return reply.code(cached.statusCode).send(cached.body);
    }
  });

  function remember(req: FastifyRequest, statusCode: number, body: unknown): void {
    const key = req.headers['idempotency-key'];
    if (typeof key === 'string' && key) {
      state.idempotency.set(key, { statusCode, body });
    }
  }

  app.get('/health', async () => ({ ok: true, sink: 'erp-simulator' }));

  app.get('/orders', async () => ({ data: [...state.orders.values()] }));

  app.get<{ Params: { id: string } }>('/orders/:id', async (req, reply) => {
    const order = state.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: 'not_found' });
    return order;
  });

  app.post('/orders', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = String(body.id ?? `ord-${state.orders.size + 1}`);
    const order: ErpOrder = {
      id,
      status: String(body.status ?? 'pending'),
      ...body,
    };
    state.orders.set(id, order);
    remember(req, 201, order);
    return reply.code(201).send(order);
  });

  app.patch<{ Params: { id: string } }>('/orders/:id', async (req, reply) => {
    const prev = state.orders.get(req.params.id);
    if (!prev) return reply.code(404).send({ error: 'not_found' });
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const next: ErpOrder = { ...prev, ...patch, id: prev.id };
    state.orders.set(prev.id, next);
    remember(req, 200, next);
    return next;
  });

  app.get('/inventory', async () => ({ data: [...state.inventory.values()] }));

  app.get<{ Params: { sku: string } }>('/inventory/:sku', async (req, reply) => {
    const row = state.inventory.get(req.params.sku);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.patch<{ Params: { sku: string } }>('/inventory/:sku', async (req, reply) => {
    const prev = state.inventory.get(req.params.sku) ?? {
      sku: req.params.sku,
      quantity: 0,
    };
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const next: ErpInventory = {
      sku: prev.sku,
      quantity:
        typeof patch.quantity === 'number' ? patch.quantity : prev.quantity,
    };
    state.inventory.set(next.sku, next);
    remember(req, 200, next);
    return next;
  });

  app.get('/suppliers', async () => ({ data: [...state.suppliers.values()] }));

  app.post('/writebacks', async (req, reply) => {
    state.writebacks += 1;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const params =
      body.params && typeof body.params === 'object'
        ? (body.params as Record<string, unknown>)
        : body;
    const orderId = String(params.orderId ?? params.id ?? '');
    if (orderId && state.orders.has(orderId)) {
      const prev = state.orders.get(orderId)!;
      const next: ErpOrder = {
        ...prev,
        status: String(params.status ?? prev.status),
      };
      state.orders.set(orderId, next);
      remember(req, 200, next);
      return reply.code(200).send(next);
    }
    const created: ErpOrder = {
      id: orderId || `wb-${state.writebacks}`,
      status: String(params.status ?? 'ok'),
    };
    state.orders.set(created.id, created);
    remember(req, 201, created);
    return reply.code(201).send(created);
  });

  return { app, state };
}

export async function listenErpSimulator(opts?: {
  port?: number;
  host?: string;
  seed?: CreateErpSimulatorOptions['seed'];
}): Promise<{ app: FastifyInstance; url: string; state: ErpSimulatorState }> {
  const { app, state } = createErpSimulator({ seed: opts?.seed });
  const host = opts?.host ?? '127.0.0.1';
  const port = opts?.port ?? 0;
  await app.listen({ host, port });
  const addr = app.server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return { app, state, url: `http://${host}:${actualPort}` };
}
