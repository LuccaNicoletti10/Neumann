import { resolve } from "node:path";
import pino from "pino";
import { createDocumentationSystem } from "./documentation-server.js";
import { DocumentRepository } from "./document-repository.js";
import { DocumentSelector } from "./document-selector.js";
import { DocumentationBuilder } from "./documentation-builder.js";
import { ServiceRegistry } from "./service-registry.js";

const DEFAULT_DOCS_DIR = resolve(process.cwd(), "docs");

function usage(): never {
  console.error(`Uso:
  cli serve [--port <n>] [--docs <dir>]
  cli render <instanceId> --service <nome@versao> [--service ...] [--docs <dir>]

Exemplos:
  cli serve --port 3000
  cli render inst-1 --service alpha@2.0.0 --service beta@1.0.0
`);
  process.exit(1);
}

function parseFlags(args: string[]): { flags: Map<string, string[]>; positional: string[] } {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[++i];
      if (value === undefined) usage();
      flags.set(key, [...(flags.get(key) ?? []), value]);
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  const docsDir = resolve(flags.get("docs")?.[0] ?? DEFAULT_DOCS_DIR);

  switch (command) {
    case "serve": {
      const port = Number(flags.get("port")?.[0] ?? 3000);
      const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
      const { app } = createDocumentationSystem({ docsDir, logger });
      await app.listen({ port, host: "0.0.0.0" });
      logger.info({ port, docsDir }, "DocumentationServer ouvindo");
      break;
    }
    case "render": {
      const instanceId = positional[0];
      if (!instanceId) usage();
      const services = flags.get("service") ?? [];
      if (services.length === 0) usage();

      const repository = new DocumentRepository(docsDir);
      const registry = new ServiceRegistry();
      registry.createInstance(instanceId);
      for (const spec of services) {
        const at = spec.lastIndexOf("@");
        if (at <= 0) usage();
        registry.install(instanceId, spec.slice(0, at), spec.slice(at + 1));
      }
      const instance = registry.getInstance(instanceId)!;
      const selector = new DocumentSelector(repository);
      const builder = new DocumentationBuilder();
      const structure = builder.buildStructure(
        instanceId,
        instance.services,
        selector.select(instance),
      );
      process.stdout.write(builder.buildMarkdown(structure));
      break;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
