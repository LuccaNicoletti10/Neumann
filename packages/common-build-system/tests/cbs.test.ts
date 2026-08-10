import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultTranslator } from "../src/adapters";
import { ArtifactRegistry } from "../src/core/artifact-registry";
import { BuildPipeline } from "../src/core/build-pipeline";
import {
  DependencyCycleError,
  UnknownDependencyError,
  buildOrderFor,
  topoSort,
} from "../src/core/dependency-graph";
import { GenericBuildCommand } from "../src/core/generic-build-command";
import { ReproducibilityVerifier } from "../src/core/reproducibility-verifier";
import { computeArtifactHash, sha256Hex } from "../src/util/hash";
import { createTar, extractTar } from "../src/util/tar";
import { BuildManifest } from "../src/types";
import { pino } from "pino";

const productsDir = path.join(__dirname, "..", "examples", "products");

function silentLogger() {
  return pino({ level: "silent" });
}

function tempRegistry(): ArtifactRegistry {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-registry-"));
  return new ArtifactRegistry(dir);
}

describe("GenericBuildCommand", () => {
  it("aceita comandos válidos", () => {
    expect(GenericBuildCommand.build().name).toBe("build");
    expect(GenericBuildCommand.test().toString()).toBe("generic:test");
  });

  it("rejeita comando inválido", () => {
    expect(() => new GenericBuildCommand("deploy")).toThrow(/inválido/);
  });
});

describe("BuildTranslator + adapters", () => {
  const translator = createDefaultTranslator();

  it("registra adapters padrão", () => {
    expect(translator.registeredTypes()).toEqual(["node-ts", "python", "script"]);
  });

  it("ScriptAdapter separa build e test", () => {
    const manifest: BuildManifest = {
      name: "x",
      version: "1.0.0",
      type: "script",
      deps: [],
      steps: [
        { name: "compile", cmd: "echo build" },
        { name: "test-unit", cmd: "echo test" },
      ],
      outputs: ["out"],
    };
    expect(translator.translate(GenericBuildCommand.build(), manifest)).toEqual([
      { name: "compile", cmd: "echo build" },
    ]);
    expect(translator.translate(GenericBuildCommand.test(), manifest)).toEqual([
      { name: "test-unit", cmd: "echo test" },
    ]);
  });
});

describe("dependency-graph", () => {
  const a: BuildManifest = {
    name: "a",
    version: "1",
    type: "script",
    deps: [],
    steps: [],
    outputs: ["out"],
  };
  const b: BuildManifest = {
    name: "b",
    version: "1",
    type: "script",
    deps: ["a"],
    steps: [],
    outputs: ["out"],
  };
  const c: BuildManifest = {
    name: "c",
    version: "1",
    type: "script",
    deps: ["b"],
    steps: [],
    outputs: ["out"],
  };

  it("ordena topologicamente", () => {
    expect(topoSort([c, a, b]).map((m) => m.name)).toEqual(["a", "b", "c"]);
  });

  it("buildOrderFor inclui só o necessário", () => {
    expect(buildOrderFor([a, b, c], "b").map((m) => m.name)).toEqual(["a", "b"]);
  });

  it("detecta ciclo", () => {
    const x: BuildManifest = { ...a, name: "x", deps: ["y"] };
    const y: BuildManifest = { ...a, name: "y", deps: ["x"] };
    expect(() => topoSort([x, y])).toThrow(DependencyCycleError);
  });

  it("detecta dependência desconhecida", () => {
    const z: BuildManifest = { ...a, name: "z", deps: ["missing"] };
    expect(() => topoSort([z])).toThrow(UnknownDependencyError);
  });
});

describe("tar determinístico", () => {
  it("createTar/extractTar roundtrip e ordem estável", () => {
    const entries = [
      { name: "b.txt", data: Buffer.from("b") },
      { name: "a.txt", data: Buffer.from("a") },
    ];
    const tar1 = createTar(entries);
    const tar2 = createTar([...entries].reverse());
    expect(tar1.equals(tar2)).toBe(true);
    expect(extractTar(tar1).map((e) => e.name)).toEqual(["a.txt", "b.txt"]);
  });
});

describe("hash", () => {
  it("sha256Hex é estável", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("computeArtifactHash é determinístico e sensível a path/hash", () => {
    const files = [
      { path: "a.txt", hash: "aa", size: 1 },
      { path: "b.txt", hash: "bb", size: 1 },
    ];
    const h1 = computeArtifactHash(files);
    const h2 = computeArtifactHash([...files].reverse());
    // Ordem importa — quem chama deve ordenar; aqui confirmamos estabilidade da função
    expect(h1).not.toBe(h2);
    expect(computeArtifactHash(files)).toBe(h1);
  });
});

describe("BuildPipeline (integração)", () => {
  it("build de script-a produz artefato e registro", async () => {
    const registry = tempRegistry();
    const pipeline = new BuildPipeline({
      productsDir,
      registry,
      logger: silentLogger(),
    });
    const record = await pipeline.run("script-a", "build");
    expect(record.status).toBe("success");
    expect(record.manifest.product).toBe("script-a");
    expect(record.manifest.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(record.packagePath)).toBe(true);
    expect(record.steps.some((s) => s.step === "generate-message")).toBe(true);
    expect(record.steps.some((s) => s.step === "test-message")).toBe(true);
  });

  it("script-b respeita ordem de dependências (script-a primeiro)", async () => {
    const registry = tempRegistry();
    const pipeline = new BuildPipeline({
      productsDir,
      registry,
      logger: silentLogger(),
    });
    const record = await pipeline.run("script-b", "build");
    expect(record.manifest.product).toBe("script-b");
    // Ambos devem estar no registry
    const products = registry.list().map((r) => r.manifest.product).sort();
    expect(products).toContain("script-a");
    expect(products).toContain("script-b");
  });
});

describe("Gate PASSO 1 — reprodutibilidade", () => {
  it("2 builds do mesmo produto → mesmo artifactHash", async () => {
    const registry = tempRegistry();
    const pipeline = new BuildPipeline({
      productsDir,
      registry,
      logger: silentLogger(),
    });
    const report = await new ReproducibilityVerifier(pipeline).verify("script-a");
    expect(report.reproducible).toBe(true);
    expect(report.runs[0]!.artifactHash).toBe(report.runs[1]!.artifactHash);
    expect(report.runs[0]!.buildId).not.toBe(report.runs[1]!.buildId);
  });
});
