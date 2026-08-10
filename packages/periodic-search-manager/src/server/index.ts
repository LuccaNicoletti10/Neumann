/**
 * Servidor HTTP (Fastify) do periodic-search-manager.
 *
 * Expõe via REST os mecanismos implementados de forma independente da patente
 * US 10,572,487 B1 (Palantir): CRUD de buscas periódicas sobre múltiplas
 * fontes ("periodic search", "multiple data sources"), execução manual e
 * consulta de resultados/alertas/runs ("result storage"), injeção de novos
 * dados em fontes para exercitar a detecção de novidades ("new-data
 * detection") e a geração de alertas ("alert/notify").
 */

import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { join } from 'node:path';
import { SearchManager } from '../core/search-manager.js';
import {
  DataSourceRegistry,
  InMemoryDataSource,
  JsonFileDataSource,
  DataSourceNotFoundError,
  type DataRecord,
} from '../core/data-source.js';
import { SearchNotFoundError } from '../core/search-store.js';
import type { Notifier, TeamDirectory } from '../core/alert-manager.js';
import type { Clock } from '../core/types.js';

const querySpecSchema = z.object({
  text: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  limit: z.number().int().nonnegative().optional(),
});

const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), everyMs: z.number().positive() }),
  z.object({
    kind: z.literal('daily'),
    hourUtc: z.number().int().min(0).max(23),
    minuteUtc: z.number().int().min(0).max(59),
  }),
]);

const createSearchSchema = z.object({
  name: z.string().min(1),
  query: querySpecSchema.optional(),
  dataSourceIds: z.array(z.string().min(1)).min(1),
  schedule: scheduleSchema,
  recipientUserIds: z.array(z.string()).optional(),
  teamIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  createdBy: z.string().optional(),
});

const updateSearchSchema = z.object({
  name: z.string().min(1).optional(),
  query: querySpecSchema.optional(),
  dataSourceIds: z.array(z.string().min(1)).min(1).optional(),
  schedule: scheduleSchema.optional(),
  recipientUserIds: z.array(z.string()).optional(),
  teamIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const addSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('memory'),
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('jsonl'),
    id: z.string().min(1),
    name: z.string().min(1),
    dir: z.string().min(1),
  }),
]);

const addRecordSchema = z.object({
  recordId: z.string().min(1),
  timestamp: z.string().min(1),
  content: z.record(z.unknown()),
});

export interface CreateAppOptions {
  dataDir: string;
  logger?: boolean;
  notifiers?: Notifier[];
  teamDirectory?: TeamDirectory;
  clock?: Clock;
  registry?: DataSourceRegistry;
}

/** Constrói o app Fastify e o SearchManager associado. */
export async function createApp(options: CreateAppOptions): Promise<{
  app: FastifyInstance;
  manager: SearchManager;
  registry: DataSourceRegistry;
}> {
  const registry = options.registry ?? new DataSourceRegistry();
  const manager = new SearchManager({
    dataDir: options.dataDir,
    registry,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.notifiers !== undefined ? { notifiers: options.notifiers } : {}),
    ...(options.teamDirectory !== undefined ? { teamDirectory: options.teamDirectory } : {}),
  });

  const app = Fastify({
    logger: options.logger ?? false,
  }) as FastifyInstance & { log: FastifyBaseLogger };

  app.get('/health', () => ({ status: 'ok' }));

  // ---- Fontes de dados (multiple data sources) ----

  app.post('/sources', async (request, reply) => {
    const parsed = addSourceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;
    if (registry.has(body.id)) {
      return reply.code(409).send({ error: `Fonte já registrada: ${body.id}` });
    }
    if (body.kind === 'memory') {
      registry.register(new InMemoryDataSource(body.id, body.name));
    } else {
      registry.register(new JsonFileDataSource(body.id, body.name, body.dir));
    }
    return reply.code(201).send({ id: body.id, name: body.name, kind: body.kind });
  });

  app.get('/sources', () =>
    registry.list().map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
  );

  app.post('/sources/:id/records', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = addRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    let source;
    try {
      source = registry.get(id);
    } catch {
      return reply.code(404).send({ error: `Fonte não encontrada: ${id}` });
    }
    if (!(source instanceof InMemoryDataSource)) {
      return reply
        .code(400)
        .send({ error: `Fonte ${id} não aceita injeção de registros (kind=${source.kind})` });
    }
    const record: DataRecord = {
      recordId: parsed.data.recordId,
      sourceId: id,
      timestamp: parsed.data.timestamp,
      content: parsed.data.content,
    };
    source.append([record]);
    return reply.code(201).send(record);
  });

  // ---- Buscas periódicas (periodic search) ----

  app.post('/searches', async (request, reply) => {
    const parsed = createSearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const search = await manager.createSearch(parsed.data);
      return reply.code(201).send(search);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.get('/searches', () => manager.listSearches());

  app.get('/searches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await manager.getSearch(id);
    } catch (err) {
      return reply.code(statusFor(err)).send({ error: errorMessage(err) });
    }
  });

  app.patch('/searches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      return await manager.updateSearch(id, parsed.data);
    } catch (err) {
      return reply.code(statusFor(err)).send({ error: errorMessage(err) });
    }
  });

  app.delete('/searches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await manager.deleteSearch(id);
    if (!deleted) {
      return reply.code(404).send({ error: `Busca não encontrada: ${id}` });
    }
    return reply.code(204).send();
  });

  app.post('/searches/:id/run', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await manager.runNow(id);
    } catch (err) {
      return reply.code(statusFor(err)).send({ error: errorMessage(err) });
    }
  });

  app.get('/searches/:id/results', async (request) => {
    const { id } = request.params as { id: string };
    return manager.listResults(id);
  });

  app.get('/searches/:id/alerts', async (request) => {
    const { id } = request.params as { id: string };
    return manager.listAlerts(id);
  });

  app.get('/searches/:id/runs', async (request) => {
    const { id } = request.params as { id: string };
    return manager.listRuns(id);
  });

  return { app, manager, registry };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusFor(err: unknown): number {
  if (err instanceof SearchNotFoundError || err instanceof DataSourceNotFoundError) {
    return 404;
  }
  return 400;
}

/** Sobe o servidor standalone (usado pelo CLI). */
export async function startServer(options: CreateAppOptions & { port: number }): Promise<void> {
  const { app } = await createApp({ ...options, logger: options.logger ?? true });
  await app.listen({ port: options.port, host: '0.0.0.0' });
  console.log(`periodic-search-manager ouvindo em http://0.0.0.0:${options.port} (dataDir=${join(options.dataDir)})`);
}