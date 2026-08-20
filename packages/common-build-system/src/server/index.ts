import fs from "node:fs";
import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { pino } from "pino";
import { GENERIC_COMMANDS } from "../types";
import { BuildPipeline } from "../core/build-pipeline";
import { ArtifactRegistry } from "../core/artifact-registry";

export interface ServerOptions {
  productsDir: string;
  registryDir: string;
  logger?: boolean;
}

const postBuildBody = z.object({
  product: z.string().min(1),
  command: z.enum(GENERIC_COMMANDS).optional().default("build"),
});

export function buildServer(options: ServerOptions): FastifyInstance {
  const logger = pino({ name: "cbs-api", level: "info" });
  const registry = new ArtifactRegistry(options.registryDir);
  const pipeline = new BuildPipeline({
    productsDir: options.productsDir,
    registry,
    logger,
  });

  const app = Fastify({ logger: options.logger ?? false });

  // Dispara um build GENÉRICO de um produto
  app.post("/builds", async (req, reply) => {
    const parsed = postBuildBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body inválido", details: parsed.error.issues });
    }
    try {
      const record = await pipeline.run(parsed.data.product, parsed.data.command);
      return reply.code(201).send(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "build falhou");
      return reply.code(422).send({ error: message });
    }
  });

  // Consulta um build pelo id
  app.get("/builds/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = registry.get(id);
    if (!record) return reply.code(404).send({ error: `build '${id}' não encontrado` });
    return reply.send(record);
  });

  // Lista os produtos do monorepo
  app.get("/products", async () => {
    return pipeline.listProducts().map((m) => ({
      name: m.name,
      version: m.version,
      type: m.type,
      deps: m.deps,
    }));
  });

  // Download do pacote dist (<name>-<version>.tgz) do build mais recente
  app.get("/products/:name/artifact", async (req, reply) => {
    const { name } = req.params as { name: string };
    const record = registry.latestFor(name);
    if (!record || !fs.existsSync(record.packagePath)) {
      return reply.code(404).send({ error: `nenhum artefato para o produto '${name}'` });
    }
    return reply
      .header("Content-Type", "application/gzip")
      .header(
        "Content-Disposition",
        `attachment; filename="${path.basename(record.packagePath)}"`
      )
      .send(fs.readFileSync(record.packagePath));
  });

  return app;
}

if (require.main === module) {
  const productsDir =
    process.env.CBS_PRODUCTS_DIR ?? path.join(process.cwd(), "examples", "products");
  const registryDir =
    process.env.CBS_REGISTRY_DIR ?? path.join(process.cwd(), ".cbs", "registry");
  const port = Number(process.env.PORT ?? 3000);
  void buildServer({ productsDir, registryDir, logger: true })
    .listen({ port, host: "0.0.0.0" })
    .then(
      (addr) => pino().info({ addr }, "API do Common Build System no ar"),
      (err: unknown) => {
        pino().error(err, "API do Common Build System falhou ao escutar");
        process.exitCode = 1;
      },
    );
}
