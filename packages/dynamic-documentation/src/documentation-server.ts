import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { DocumentRepository } from "./document-repository.js";
import { DocWatcher } from "./doc-watcher.js";
import { DocumentSelector } from "./document-selector.js";
import { ServiceRegistry } from "./service-registry.js";
import { InstallServiceBodySchema } from "./types.js";

export interface DocumentationSystemOptions {
  docsDir: string;
  logger?: Logger | false;
}

export interface DocumentationSystem {
  app: FastifyInstance;
  repository: DocumentRepository;
  registry: ServiceRegistry;
  selector: DocumentSelector;
  watcher: DocWatcher;
}

function renderIndex(registry: ServiceRegistry): string {
  const instances = registry.listInstances();
  const items = instances
    .map(
      (inst) => `<li>
        <strong>${inst.instanceId}</strong>
        [${inst.services.map((s) => `${s.name}@${s.version}`).join(", ") || "sem serviços"}]
        — <a href="/instances/${inst.instanceId}/docs">docs (markdown)</a>
        | <a href="/instances/${inst.instanceId}/docs.json">docs (json)</a>
      </li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Dynamic Documentation</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 52rem; }
    code, pre { background: #f4f4f4; padding: 0.15rem 0.35rem; border-radius: 4px; }
    pre { padding: 1rem; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Documentação Dinâmica por Serviços Instalados</h1>
  <h2>Instâncias</h2>
  <ul>
    ${items || "<li><em>Nenhuma instância registrada.</em></li>"}
  </ul>
  <h2>API</h2>
  <pre>POST   /instances/:id                 (cria instância)
POST   /instances/:id/services        { "name": "alpha", "version": "2.0.0" }
DELETE /instances/:id/services/:name
GET    /instances/:id/docs            (markdown dinâmico)
GET    /instances/:id/docs.json       (estrutura JSON)</pre>
</body>
</html>`;
}

export function createDocumentationSystem(
  options: DocumentationSystemOptions,
): DocumentationSystem {
  const logger = options.logger === false ? undefined : options.logger;
  const app: FastifyInstance = Fastify({
    logger: options.logger !== false,
  });

  const repository = new DocumentRepository(options.docsDir, logger);
  const registry = new ServiceRegistry();
  const selector = new DocumentSelector(repository);
  const watcher = new DocWatcher(registry, selector, logger);

  // ---- UI mínima ----
  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send(renderIndex(registry));
  });

  // ---- Criar instância explicitamente (opcional; install auto-cria) ----
  app.post("/instances/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    registry.createInstance(id);
    reply.code(201).send({ instanceId: id });
  });

  // ---- Documento dinâmico (markdown) ----
  app.get("/instances/:id/docs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const compiled = watcher.getDocumentation(id);
    if (!compiled) {
      return reply.code(404).send({ error: `Instância não encontrada: ${id}` });
    }
    reply.type("text/markdown; charset=utf-8").send(compiled.markdown);
  });

  // ---- Documento dinâmico (estrutura JSON) ----
  app.get("/instances/:id/docs.json", async (req, reply) => {
    const { id } = req.params as { id: string };
    const compiled = watcher.getDocumentation(id);
    if (!compiled) {
      return reply.code(404).send({ error: `Instância não encontrada: ${id}` });
    }
    reply.send(compiled.structure);
  });

  // ---- Install / upgrade de serviço (regenera a documentação) ----
  app.post("/instances/:id/services", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = InstallServiceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const { action, service } = registry.install(
        id,
        parsed.data.name,
        parsed.data.version,
      );
      const compiled = watcher.getDocumentation(id)!;
      reply.code(action === "upgrade" ? 200 : 201).send({
        action,
        service,
        documents: compiled.structure.documents.length,
      });
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ---- Uninstall de serviço (regenera a documentação) ----
  app.delete("/instances/:id/services/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    if (!registry.hasInstance(id)) {
      return reply.code(404).send({ error: `Instância não encontrada: ${id}` });
    }
    if (!registry.uninstall(id, name)) {
      return reply
        .code(404)
        .send({ error: `Serviço não instalado: ${name} em ${id}` });
    }
    const compiled = watcher.getDocumentation(id)!;
    reply.send({
      action: "uninstall",
      service: name,
      documents: compiled.structure.documents.length,
    });
  });

  return { app, repository, registry, selector, watcher };
}
