/**
 * server/index.ts — API HTTP do Passo 3 (IAM + monitoramento de autenticacao).
 *
 * Rotas:
 *   POST /register                         (publica) cria usuario
 *   POST /login                            (publica) email+password ou apiKey -> sessao
 *   POST /service-accounts                 (admin)   cria service account, retorna API key 1x
 *   GET  /me                               (protegida — prova o gate do passo)
 *   GET  /protected-example                (protegida)
 *   GET/POST/DELETE/PATCH /auth-rules      (admin)   gerencia NotificationRules
 *   GET  /auth-attempts                    (admin)   historico de tentativas
 *   GET  /auth-metrics                     (admin)   snapshot das metricas
 *   GET  /notifications                    (admin)   historico de notificacoes
 *   POST /notifications/:attemptId/confirm       usuario confirma a tentativa
 *   POST /notifications/:attemptId/report-breach usuario reporta violacao (+ opcao de desabilitar)
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createAuthHook, requireAdmin } from '../identity/auth-hook.js';
import { IdentityProvider, type AuthenticateInput } from '../identity/identity-provider.js';
import { InMemoryPrincipalStore, type Principal } from '../identity/principal-store.js';
import { createAuthMonitoring, type AuthMonitoringBundle } from '../auth-monitoring/login-monitor.js';
import { ConsoleNotifier, type Notifier } from '../auth-monitoring/notifiers.js';
import type { GeoLocation } from '../auth-monitoring/auth-record.js';
import type { CombinationMode } from '../auth-monitoring/rules.js';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  notificationHandles: z.object({ email: z.string().optional(), sms: z.string().optional() }).optional(),
});

const loginSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    location: z.object({ lat: z.number(), lon: z.number() }).optional(),
  })
  .refine((v) => (v.email !== undefined && v.password !== undefined) || v.apiKey !== undefined, {
    message: 'informe email+password ou apiKey',
  });

const serviceAccountSchema = z.object({
  name: z.string().min(1),
  roles: z.array(z.string()).optional(),
  notificationHandles: z.object({ email: z.string().optional(), sms: z.string().optional() }).optional(),
});

const ruleSchema = z.object({
  type: z.enum([
    'user-whitelist',
    'network-whitelist',
    'once-per-location-per-day',
    'notify-only-on-success',
    'multi-user',
    'location-based',
    'time-window',
    'latency-based',
  ]),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  params: z.record(z.unknown()).default({}),
});

const reportBreachSchema = z.object({ disablePrincipal: z.boolean().default(false) });

type PublicPrincipal = Omit<Principal, 'passwordHash' | 'apiKeyHash'>;

function toPublic(principal: Principal): PublicPrincipal {
  const { passwordHash: _pw, apiKeyHash: _key, ...pub } = principal;
  return pub;
}

export interface BuildServerOptions {
  store: InMemoryPrincipalStore;
  provider: IdentityProvider;
  monitoring: AuthMonitoringBundle;
  publicRoutes?: string[];
  logger?: boolean;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { provider, monitoring } = options;
  const app = Fastify({ logger: options.logger ?? false });

  app.decorateRequest('principal', null);
  app.addHook(
    'preHandler',
    createAuthHook(provider, {
      publicRoutes: options.publicRoutes ?? ['/login', '/register', '/health'],
    }),
  );

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      const principal = provider.registerUser(parsed.data);
      return reply.code(201).send({ principal: toPublic(principal) });
    } catch (err) {
      return reply.code(409).send({ error: 'register_failed', message: (err as Error).message });
    }
  });

  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const body = parsed.data;
    const input: AuthenticateInput =
      body.apiKey !== undefined
        ? { kind: 'apiKey', apiKey: body.apiKey }
        : { kind: 'password', email: body.email as string, password: body.password as string };
    const location: GeoLocation | undefined = body.location;
    const result = provider.authenticate(input, {
      ip: request.ip,
      ...(request.headers['user-agent'] !== undefined ? { userAgent: request.headers['user-agent'] } : {}),
      ...(location !== undefined ? { location } : {}),
    });
    if (!result.ok) return reply.code(401).send({ error: result.reason, attemptId: result.attempt.attemptId });
    return reply.send({
      token: result.session.token,
      expiresAt: result.session.expiresAt,
      attemptId: result.attempt.attemptId,
      principal: toPublic(result.principal),
    });
  });

  app.post('/service-accounts', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = serviceAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { principal, apiKey } = provider.createServiceAccount(parsed.data);
    return reply.code(201).send({ principal: toPublic(principal), apiKey });
  });

  app.get('/me', async (request) => ({ principal: toPublic(request.principal as Principal) }));

  app.get('/protected-example', async (request) => ({
    message: 'recurso protegido acessado',
    principalId: (request.principal as Principal).id,
  }));

  // ---------- rotas admin: regras ----------

  app.get('/auth-rules', { preHandler: requireAdmin }, async () => ({ rules: monitoring.ruleBook.list() }));

  app.post('/auth-rules', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const rule = monitoring.ruleBook.addRule(parsed.data);
    return reply.code(201).send({ rule });
  });

  app.patch('/auth-rules/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    const rule = monitoring.ruleBook.setEnabled(id, body.data.enabled);
    if (rule === undefined) return reply.code(404).send({ error: 'rule_not_found' });
    return reply.send({ rule });
  });

  app.delete('/auth-rules/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!monitoring.ruleBook.removeRule(id)) return reply.code(404).send({ error: 'rule_not_found' });
    return reply.code(204).send();
  });

  // ---------- consulta de tentativas / metricas / notificacoes ----------

  app.get('/auth-attempts', { preHandler: requireAdmin }, async () => ({
    attempts: monitoring.monitor.listAttempts(),
  }));

  app.get('/auth-metrics', { preHandler: requireAdmin }, async () => monitoring.metrics.snapshot());

  app.get('/notifications', { preHandler: requireAdmin }, async () => ({
    notifications: monitoring.engine.listHistory(),
  }));

  // ---------- resposta do usuario as notificacoes ----------

  app.post('/notifications/:attemptId/confirm', async (request) => {
    const { attemptId } = request.params as { attemptId: string };
    const confirmed = monitoring.engine.confirmAttempt(attemptId);
    return { attemptId, confirmed: confirmed.length };
  });

  app.post('/notifications/:attemptId/report-breach', async (request, reply) => {
    const { attemptId } = request.params as { attemptId: string };
    const parsed = reportBreachSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const result = monitoring.engine.reportBreach(attemptId, {
      disablePrincipal: parsed.data.disablePrincipal,
    });
    return reply.send({
      attemptId,
      breachMarked: result.breachMarked,
      principalDisabled: result.principalDisabled,
    });
  });

  return app;
}

// ---------- bootstrap completo (start / CLI serve) ----------

export interface AppComponents {
  app: FastifyInstance;
  store: InMemoryPrincipalStore;
  provider: IdentityProvider;
  monitoring: AuthMonitoringBundle;
}

export interface CreateAppOptions {
  dataDir?: string;
  mode?: CombinationMode;
  notifiers?: Notifier[];
  logger?: boolean;
}

export function createApp(options: CreateAppOptions = {}): AppComponents {
  const dataDir = options.dataDir;
  const store = new InMemoryPrincipalStore(
    dataDir !== undefined ? { filePath: `${dataDir}/principals.json` } : {},
  );
  const provider = new IdentityProvider(store);
  const monitoring = createAuthMonitoring({
    store,
    provider,
    notifiers: options.notifiers ?? [new ConsoleNotifier()],
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(dataDir !== undefined
      ? { rulesFilePath: `${dataDir}/rules.json`, attemptsLogPath: `${dataDir}/attempts.jsonl` }
      : {}),
  });
  const app = buildServer({
    store,
    provider,
    monitoring,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });
  return { app, store, provider, monitoring };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env['PORT'] ?? 3000);
  const dataDir = process.env['PASSO03_DATA_DIR'] ?? './data';
  const { app } = createApp({ dataDir, logger: true });
  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
