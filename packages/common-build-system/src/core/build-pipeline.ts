import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pino } from "pino";
import { BuildManifest, GenericCommandName, SignedBuildManifest } from "../types";
import { loadAllManifests } from "../util/manifest";
import { computeArtifactHash, hashOutputs, HashedFile } from "../util/hash";
import { BuildTranslator } from "./build-translator";
import { GenericBuildCommand } from "./generic-build-command";
import { buildOrderFor } from "./dependency-graph";
import { StepLog, VirtualizationEnvironment } from "./virtualization-environment";
import { ArtifactRegistry, BuildRecord } from "./artifact-registry";
import { DistPackager } from "./dist-packager";
import { createDefaultTranslator } from "../adapters";

export class SecurityScanError extends Error {
  constructor(product: string, file: string, pattern: string) {
    super(
      `Security scan reprovou o produto '${product}': arquivo '${file}' corresponde ao padrão proibido ${pattern}`
    );
    this.name = "SecurityScanError";
  }
}

export type SecurityScanHook = (ctx: {
  manifest: BuildManifest;
  workDir: string;
  files: HashedFile[];
}) => void;

const DEFAULT_BANNED_PATTERNS: RegExp[] = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/];

export const defaultSecurityScan: SecurityScanHook = ({ manifest, workDir, files }) => {
  for (const f of files) {
    const content = fs.readFileSync(path.join(workDir, f.path), "utf8");
    for (const pattern of DEFAULT_BANNED_PATTERNS) {
      if (pattern.test(content)) {
        throw new SecurityScanError(manifest.name, f.path, String(pattern));
      }
    }
  }
};

export interface BuildPipelineOptions {
  productsDir: string;
  registry: ArtifactRegistry;
  translator?: BuildTranslator;
  securityScan?: SecurityScanHook;
  logger?: pino.Logger;
}

export class BuildPipeline {
  private readonly translator: BuildTranslator;
  private readonly securityScan: SecurityScanHook;
  private readonly packager = new DistPackager();
  private readonly logger: pino.Logger;

  constructor(private readonly options: BuildPipelineOptions) {
    this.translator = options.translator ?? createDefaultTranslator();
    this.securityScan = options.securityScan ?? defaultSecurityScan;
    this.logger = options.logger ?? pino({ name: "build-pipeline", level: "info" });
  }

  listProducts(): BuildManifest[] {
    return loadAllManifests(this.options.productsDir);
  }

  async run(productName: string, command: GenericCommandName = "build"): Promise<BuildRecord> {
    const manifests = this.listProducts();
    const order = buildOrderFor(manifests, productName);
    this.logger.info(
      { product: productName, command, order: order.map((m) => m.name) },
      "pipeline iniciado"
    );
    let target: BuildRecord | undefined;
    for (const manifest of order) {
      const record = await this.buildOne(manifest, command);
      if (record.manifest.product === productName) target = record;
    }
    if (!target) throw new Error(`Pipeline não produziu registro para '${productName}'`);
    return target;
  }

  private async buildOne(
    manifest: BuildManifest,
    command: GenericCommandName
  ): Promise<BuildRecord> {
    const buildId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const productDir = path.join(this.options.productsDir, this.dirOf(manifest.name));
    const env = VirtualizationEnvironment.create(productDir);
    const steps: StepLog[] = [];
    try {
      // 1) build: traduz o comando genérico e executa no ambiente isolado
      const buildSteps = this.translator.translate(new GenericBuildCommand("build"), manifest);
      steps.push(...(await env.runSteps(buildSteps)));

      // 2) test
      const testSteps = this.translator.translate(new GenericBuildCommand("test"), manifest);
      steps.push(...(await env.runSteps(testSteps)));

      // 3) coleta determinista dos outputs
      const files = hashOutputs(env.workDir, manifest.outputs);

      // 4) security scan (hook)
      this.securityScan({ manifest, workDir: env.workDir, files });

      // 5) artifact: manifesto assinado por hash + pacote dist uniforme
      const signed: SignedBuildManifest = {
        product: manifest.name,
        version: manifest.version,
        artifactHash: computeArtifactHash(files),
        files,
        createdAt,
        buildId,
      };
      const pkg = this.packager.pack(signed, env.workDir, files);
      const record = this.options.registry.save(
        { manifest: signed, command, status: "success", steps },
        pkg.data,
        pkg.fileName
      );
      this.logger.info(
        { product: manifest.name, buildId, artifactHash: signed.artifactHash },
        "build concluído"
      );
      return record;
    } finally {
      env.cleanup();
    }
  }

  private dirOf(productName: string): string {
    for (const entry of fs.readdirSync(this.options.productsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.options.productsDir, entry.name, "build.manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string };
      if (m.name === productName) return entry.name;
    }
    throw new Error(`Diretório do produto '${productName}' não encontrado`);
  }
}
