#!/usr/bin/env node
import path from "node:path";
import { pino } from "pino";
import { isGenericCommandName } from "./types";
import { BuildPipeline } from "./core/build-pipeline";
import { ArtifactRegistry } from "./core/artifact-registry";
import { ReproducibilityVerifier } from "./core/reproducibility-verifier";
import { buildServer } from "./server/index";

interface CliFlags {
  root: string;
  registry: string;
  port: number;
  quiet: boolean;
}

function parseFlags(args: string[]): CliFlags {
  const flags: CliFlags = {
    root: path.join(process.cwd(), "examples", "products"),
    registry: path.join(process.cwd(), ".cbs", "registry"),
    port: 3000,
    quiet: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") flags.root = path.resolve(args[++i] ?? flags.root);
    else if (a === "--registry") flags.registry = path.resolve(args[++i] ?? flags.registry);
    else if (a === "--port") flags.port = Number(args[++i]);
    else if (a === "--quiet" || a === "-q") flags.quiet = true;
  }
  return flags;
}

function usage(): never {
  console.error(`Common Build System — CLI

Uso:
  node dist/cli.js build <produto>     Build genérico (build+test+scan+artifact)
  node dist/cli.js test <produto>      Executa a fase de teste
  node dist/cli.js package <produto>   Build + pacote dist uniforme
  node dist/cli.js verify <produto>    Prova de reprodutibilidade (2 builds)
  node dist/cli.js list                Lista os produtos do monorepo
  node dist/cli.js serve               Sobe a API (ArtifactRegistry)

Flags: --root <dir>  --registry <dir>  --port <n>  --quiet
`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, product, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  const flags = parseFlags(rest);
  const logger = pino({ name: "cbs-cli", level: flags.quiet ? "silent" : "info" });
  const registry = new ArtifactRegistry(flags.registry);
  const pipeline = new BuildPipeline({ productsDir: flags.root, registry, logger });

  if (cmd === "list") {
    for (const m of pipeline.listProducts()) {
      console.log(`${m.name}@${m.version}  type=${m.type}  deps=[${m.deps.join(", ")}]`);
    }
    return;
  }

  if (cmd === "serve") {
    const app = buildServer({
      productsDir: flags.root,
      registryDir: flags.registry,
      logger: !flags.quiet,
    });
    const addr = await app.listen({ port: flags.port, host: "0.0.0.0" });
    console.log(`API ouvindo em ${addr}`);
    return;
  }

  if (!product) usage();

  if (cmd === "verify") {
    const report = await new ReproducibilityVerifier(pipeline).verify(product);
    console.log(JSON.stringify(report, null, 2));
    if (!report.reproducible) process.exit(1);
    return;
  }

  if (!isGenericCommandName(cmd)) {
    console.error(`Comando desconhecido: ${cmd}`);
    usage();
  }
  const record = await pipeline.run(product, cmd);
  console.log(JSON.stringify(record.manifest, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
