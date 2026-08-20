/**
 * API (fastify) — expoe os componentes via HTTP.
 */

import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { CentralLogRepository } from "../core/central-repository";
import { Datastore, defaultDatastorePath } from "../core/datastore";
import { LogEntryComponent } from "../core/log-entry-component";
import { OrderedPatternList } from "../core/search-pattern-module";
import { SearchPatternGenerator } from "../core/search-pattern-generator";

export interface AppContext {
  datastore: Datastore;
  repository: CentralLogRepository;
  daemon: LogEntryComponent;
  generator: SearchPatternGenerator;
}

export function createContext(datastorePath: string = defaultDatastorePath()): AppContext {
  const datastore = new Datastore(datastorePath);
  const repository = new CentralLogRepository();
  const daemon = new LogEntryComponent(repository);
  const generator = new SearchPatternGenerator(datastore);
  const state = datastore.load();
  if (state.patterns.length > 0) {
    const list = new OrderedPatternList();
    list.setAll(state.patterns.map((p) => ({ ...p, matchCount: 0 })));
    daemon.setPatterns(list);
  }
  return { datastore, repository, daemon, generator };
}

const generateSchema = z.object({
  repoDir: z.string().min(1),
  threshold: z.number().int().min(0).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
});

const ingestSchema = z
  .object({
    message: z.string().optional(),
    messages: z.array(z.string()).optional(),
  })
  .refine((v) => v.message !== undefined || v.messages !== undefined, {
    message: 'informe "message" ou "messages"',
  });

export function buildServer(ctx: AppContext = createContext()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post("/patterns/generate", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map((i) => i.message) });
    }
    const { repoDir, threshold, similarityThreshold } = parsed.data;
    let result;
    try {
      result = ctx.generator.generateConfig(repoDir, { threshold, similarityThreshold });
    } catch (err) {
      return reply
        .status(400)
        .send({ error: `falha ao examinar repoDir: ${(err as Error).message}` });
    }
    ctx.generator.configure(ctx.daemon);
    return reply.send({
      repoDir: result.repoDir,
      loggingCallCount: result.loggingCalls.length,
      report: result.report,
      patterns: result.patterns,
    });
  });

  app.get("/patterns", async () => {
    const state = ctx.datastore.load();
    return { patterns: state.patterns };
  });

  app.post("/logs/ingest", async (req, reply) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map((i) => i.message) });
    }
    const messages = parsed.data.messages ?? [parsed.data.message as string];
    const results = messages.map((m) => ({ message: m, ...ctx.daemon.ingest(m) }));
    return reply.send({
      matched: results.filter((r) => r.status === "matched").length,
      dropped: results.filter((r) => r.status === "dropped").length,
      results,
    });
  });

  app.get("/logs", async (req) => {
    const q = req.query as Record<string, string>;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (k.startsWith("param.")) params[k.slice("param.".length)] = v;
    }
    const entries = ctx.repository.query({
      patternId: q.patternId,
      function: q.function,
      params: Object.keys(params).length > 0 ? params : undefined,
    });
    return {
      entries,
      countByPattern: ctx.repository.countByPattern(),
      countByFunction: ctx.repository.countByFunction(),
    };
  });

  app.get("/stats", async () => ctx.daemon.stats());

  return app;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const app = buildServer();
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`API ouvindo na porta ${port}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
