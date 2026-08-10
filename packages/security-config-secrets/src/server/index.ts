/**
 * Passo 3 / US20250298632A1 + SOPS+age:
 * API HTTP (fastify 4 + zod + pino):
 *  - Parte B: GET /envs, GET /envs/:name/config, GET /envs/:name/gui,
 *    POST /envs/:name/changes, POST /envs/:name/apply,
 *    POST /envs/:name/apply-changes (usado pela GUI), GET /envs/:name/history,
 *    GET /envs/:name/diff.
 *  - Parte C: POST /secrets/:env/:key (chave secreta no header
 *    x-age-secret-key), GET /secrets/:env/keys, GET /layout/scan?root=.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConfigServer, EnvNotFoundError, VersionConflictError } from '../env-config/config-service.js';
import { ChangeComputer, type ScalarValue } from '../env-config/change-computer.js';
import { GuiGenerator } from '../env-config/gui-generator.js';
import { SecretsManager } from '../secrets/secrets-manager.js';
import { RepoLayoutGuard } from '../secrets/layout-guard.js';

export interface ServerOptions {
  rootDir: string;
  logger?: boolean;
}

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const instructionSchema = z.object({
  locationId: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
  deleteCount: z.number().int().nonnegative(),
  insertText: z.string(),
  path: z.string(),
});

const changeSchema = z.object({ path: z.string().min(1), value: scalarSchema });

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const configs = new ConfigServer(opts.rootDir);
  const computer = new ChangeComputer();
  const gui = new GuiGenerator();
  const guard = new RepoLayoutGuard();

  const notFound = (err: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (err instanceof EnvNotFoundError) return reply.code(404).send({ message: err.message });
    throw err;
  };

  // ---------- Parte B: env-config ----------
  app.get('/envs', async () => ({ envs: configs.listEnvs() }));

  app.get('/envs/:name/config', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const { text, indexed, version } = configs.getConfig(name);
      return {
        name,
        version,
        text,
        index: indexed.nodes.map((n) => ({
          path: n.path,
          type: n.type,
          start: n.start,
          end: n.end,
          ...(n.value !== undefined ? { value: n.value } : {}),
        })),
      };
    } catch (err) {
      return notFound(err, reply);
    }
  });

  app.get('/envs/:name/gui', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const { indexed } = configs.getConfig(name);
      const schemaParam = (req.query as { enum?: string }).enum;
      const schema = schemaParam ? (JSON.parse(schemaParam) as Record<string, { enum?: Array<string | number> }>) : {};
      return reply.type('text/html').send(gui.generate(indexed, name, schema));
    } catch (err) {
      return notFound(err, reply);
    }
  });

  app.post('/envs/:name/changes', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = changeSchema.parse(req.body);
    try {
      const { indexed } = configs.getConfig(name);
      return { instructions: [computer.compute(indexed, body.path, body.value as ScalarValue)] };
    } catch (err) {
      return notFound(err, reply);
    }
  });

  app.post('/envs/:name/apply', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = z
      .object({
        instructions: z.array(instructionSchema).min(1),
        baseVersion: z.number().int().positive(),
        author: z.string().default('api'),
      })
      .parse(req.body);
    try {
      const version = configs.apply(name, body.instructions, body.baseVersion, body.author);
      return { applied: true, version: version.version, appliedAt: version.appliedAt };
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return reply.code(409).send({ message: err.message, currentVersion: err.currentVersion });
      }
      return notFound(err, reply);
    }
  });

  // Fluxo da GUI: calcula instructions no estado atual e aplica atomicamente.
  app.post('/envs/:name/apply-changes', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = z
      .object({
        changes: z.array(changeSchema).min(1),
        author: z.string().default('gui'),
      })
      .parse(req.body);
    try {
      const { indexed, version } = configs.getConfig(name);
      const instructions = computer.computeAll(
        indexed,
        body.changes.map((c) => ({ path: c.path, value: c.value as ScalarValue })),
      );
      const applied = configs.apply(name, instructions, version, body.author);
      return { applied: true, version: applied.version, instructions };
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return reply.code(409).send({ message: err.message, currentVersion: err.currentVersion });
      }
      return notFound(err, reply);
    }
  });

  app.get('/envs/:name/history', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      return {
        name,
        history: configs.history(name).map((v) => ({
          version: v.version,
          appliedAt: v.appliedAt,
          author: v.author,
          instructions: v.instructions,
        })),
      };
    } catch (err) {
      return notFound(err, reply);
    }
  });

  app.get('/envs/:name/diff', async (req, reply) => {
    const { name } = req.params as { name: string };
    const q = z
      .object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() })
      .parse(req.query);
    try {
      return { name, from: q.from, to: q.to, diff: configs.diff(name, q.from, q.to) };
    } catch (err) {
      return notFound(err, reply);
    }
  });

  // ---------- Parte C: secrets + layout ----------
  const secretsFromHeader = (req: { headers: Record<string, unknown> }): SecretsManager => {
    const key = req.headers['x-age-secret-key'];
    if (typeof key !== 'string' || key === '') {
      throw Object.assign(new Error('header x-age-secret-key obrigatorio'), { statusCode: 401 });
    }
    return new SecretsManager(opts.rootDir, key, []);
  };

  app.post('/secrets/:env/:key', async (req, reply) => {
    const { env, key } = req.params as { env: string; key: string };
    const body = z.object({ value: z.string() }).parse(req.body);
    try {
      secretsFromHeader(req).set(env, key, body.value);
      return { ok: true, env, key };
    } catch (err) {
      const e = err as { statusCode?: number; message: string };
      return reply.code(e.statusCode ?? 400).send({ message: e.message });
    }
  });

  app.get('/secrets/:env/keys', async (req, reply) => {
    const { env } = req.params as { env: string };
    try {
      return { env, keys: secretsFromHeader(req).listKeys(env) };
    } catch (err) {
      const e = err as { statusCode?: number; message: string };
      return reply.code(e.statusCode ?? 400).send({ message: e.message });
    }
  });

  app.get('/layout/scan', async (req) => {
    const q = z.object({ root: z.string().min(1) }).parse(req.query);
    return guard.scan(q.root);
  });

  return app;
}

/** Entrypoint quando executado diretamente (node dist/server/index.js). */
export async function startServer(port: number, rootDir: string): Promise<FastifyInstance> {
  const app = buildServer({ rootDir, logger: true });
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}