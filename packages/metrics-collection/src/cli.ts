/**
 * CLI — serve / submit / score / categories / deployments / products
 */
import { MetricsCollectionSystem } from "./core/metrics-system.js";
import { buildServer } from "./server/index.js";

const DEFAULT_STORE = process.env.METRICS_STORE ?? "./metrics-store.json";

interface ParsedArgs {
  command: string | undefined;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

const USAGE = `Uso:
  cli serve --port <n> [--store <path>] [--no-self-metrics]
  cli submit --deployment D --product P --umi U --value V [--store <path>]
  cli score --category C [--deployment D] [--product P] [--store <path>]
  cli categories [--store <path>]
  cli deployments | products [--store <path>]`;

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const storePath = flags.store ?? DEFAULT_STORE;

  switch (command) {
    case "serve": {
      const port = Number(flags.port ?? 3000);
      if (!Number.isInteger(port) || port <= 0) throw new Error("--port inválida");
      const system = new MetricsCollectionSystem({
        storePath,
        metricsOnMetrics: flags["no-self-metrics"] !== "true",
      });
      system.collection.start();
      const app = buildServer(system, { logger: true });
      await app.listen({ port, host: "0.0.0.0" });
      console.log(`Servidor em http://localhost:${port} (store: ${storePath})`);
      break;
    }
    case "submit": {
      const { deployment, product, umi, value } = flags;
      if (!deployment || !umi || value === undefined) {
        throw new Error("submit requer --deployment, --umi e --value");
      }
      const system = new MetricsCollectionSystem({ storePath });
      const result = system.submit({
        deploymentId: deployment,
        product: product ?? "unknown",
        metrics: [{ umi, value: Number(value) }],
      });
      console.log(`Submissão aceita: ${result.accepted} métrica(s)`);
      break;
    }
    case "score": {
      const { category, deployment, product } = flags;
      if (!category) throw new Error("score requer --category");
      const system = new MetricsCollectionSystem({ storePath });
      const score = system.getScore({
        category,
        ...(deployment !== undefined ? { deploymentId: deployment } : {}),
        ...(product !== undefined ? { product } : {}),
      });
      console.log(
        JSON.stringify({
          category,
          deploymentId: deployment ?? null,
          product: product ?? null,
          score,
        })
      );
      break;
    }
    case "categories": {
      const system = new MetricsCollectionSystem({ storePath });
      console.log(JSON.stringify(system.listCategories(), null, 2));
      break;
    }
    case "deployments": {
      const system = new MetricsCollectionSystem({ storePath });
      console.log(JSON.stringify(system.listDeployments(), null, 2));
      break;
    }
    case "products": {
      const system = new MetricsCollectionSystem({ storePath });
      console.log(JSON.stringify(system.listProducts(), null, 2));
      break;
    }
    default:
      console.log(USAGE);
      if (command !== undefined && command !== "help") process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
