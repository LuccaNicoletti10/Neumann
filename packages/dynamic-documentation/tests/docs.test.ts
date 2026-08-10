import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentRepository } from "../src/document-repository.js";
import { DocumentSelector } from "../src/document-selector.js";
import { DocumentationBuilder } from "../src/documentation-builder.js";
import { ServiceRegistry } from "../src/service-registry.js";
import { DocWatcher } from "../src/doc-watcher.js";
import { createDocumentationSystem } from "../src/documentation-server.js";

const docsDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "docs");

describe("DocumentRepository", () => {
  it("carrega documentos do diretório", () => {
    const repo = new DocumentRepository(docsDir);
    const ids = repo.list().map((d) => d.id);
    expect(ids).toContain("alpha-intro");
    expect(ids).toContain("beta-ops");
    expect(ids).toContain("alpha-beta-bridge");
  });
});

describe("DocumentSelector", () => {
  const repo = new DocumentRepository(docsDir);
  const selector = new DocumentSelector(repo);

  it("seleciona docs do serviço instalado e filtra subsections por versão", () => {
    const registry = new ServiceRegistry();
    registry.createInstance("i1");
    registry.install("i1", "alpha", "1.5.0", new Date("2026-01-01T00:00:00.000Z"));
    const selected = selector.select(registry.getInstance("i1")!);
    expect(selected.map((d) => d.id)).toEqual(["alpha-intro"]);
    expect(selected[0]!.subsections.map((s) => s.id)).toEqual([
      "alpha-intro-quickstart",
    ]);
  });

  it("inclui subsection v2 quando alpha>=2", () => {
    const registry = new ServiceRegistry();
    registry.createInstance("i2");
    registry.install("i2", "alpha", "2.0.0", new Date("2026-01-01T00:00:00.000Z"));
    const selected = selector.select(registry.getInstance("i2")!);
    expect(selected[0]!.subsections.map((s) => s.id)).toContain("alpha-intro-v2");
  });

  it("documento overlap exige todos os serviços", () => {
    const registry = new ServiceRegistry();
    registry.createInstance("i3");
    registry.install("i3", "alpha", "2.0.0", new Date("2026-01-01T00:00:00.000Z"));
    registry.install("i3", "beta", "1.0.0", new Date("2026-01-01T00:00:00.000Z"));
    const selected = selector.select(registry.getInstance("i3")!);
    expect(selected.map((d) => d.id).sort()).toEqual([
      "alpha-beta-bridge",
      "alpha-intro",
      "beta-ops",
    ]);
  });
});

describe("DocumentationBuilder", () => {
  it("gera markdown estável", () => {
    const repo = new DocumentRepository(docsDir);
    const selector = new DocumentSelector(repo);
    const registry = new ServiceRegistry();
    registry.createInstance("demo");
    registry.install("demo", "alpha", "2.0.0", new Date("2026-01-01T00:00:00.000Z"));
    const instance = registry.getInstance("demo")!;
    const builder = new DocumentationBuilder();
    const structure = builder.buildStructure(
      "demo",
      instance.services,
      selector.select(instance),
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const md = builder.buildMarkdown(structure);
    expect(md).toContain("# Documentação Dinâmica — Instância `demo`");
    expect(md).toContain("Introdução ao Alpha");
    expect(md).toContain("Recursos exclusivos do Alpha v2");
    expect(md).toContain("`alpha@2.0.0`");
  });
});

describe("DocWatcher", () => {
  it("invalida cache ao instalar serviço", () => {
    const repo = new DocumentRepository(docsDir);
    const registry = new ServiceRegistry();
    const watcher = new DocWatcher(registry, new DocumentSelector(repo));
    registry.createInstance("w1");
    const empty = watcher.getDocumentation("w1")!;
    expect(empty.structure.documents).toHaveLength(0);
    registry.install("w1", "beta", "1.0.0");
    const after = watcher.getDocumentation("w1")!;
    expect(after.structure.documents.map((d) => d.id)).toEqual(["beta-ops"]);
  });
});

describe("DocumentationServer HTTP", () => {
  it("instala serviço e serve markdown", async () => {
    const { app } = createDocumentationSystem({ docsDir, logger: false });
    await app.ready();

    const create = await app.inject({ method: "POST", url: "/instances/http-1" });
    expect(create.statusCode).toBe(201);

    const install = await app.inject({
      method: "POST",
      url: "/instances/http-1/services",
      payload: { name: "alpha", version: "2.1.0" },
    });
    expect(install.statusCode).toBe(201);
    expect(install.json().documents).toBeGreaterThan(0);

    const docs = await app.inject({ method: "GET", url: "/instances/http-1/docs" });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toMatch(/markdown/);
    expect(docs.body).toContain("Introdução ao Alpha");

    await app.close();
  });
});
