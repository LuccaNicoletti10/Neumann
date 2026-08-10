/**
 * CLI — generate / ingest / patterns / stats / serve
 */

import * as fs from "fs";
import { CentralLogRepository } from "./core/central-repository";
import { Datastore, defaultDatastorePath } from "./core/datastore";
import { LogEntryComponent } from "./core/log-entry-component";
import { OrderedPatternList } from "./core/search-pattern-module";
import { SearchPatternGenerator } from "./core/search-pattern-generator";
import { buildServer, createContext } from "./server";

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function printJson(value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(value, null, 2));
}

function loadDaemon(datastore: Datastore): {
  daemon: LogEntryComponent;
  repository: CentralLogRepository;
} {
  const repository = new CentralLogRepository();
  const daemon = new LogEntryComponent(repository);
  const state = datastore.load();
  const list = new OrderedPatternList();
  list.setAll(state.patterns.map((p) => ({ ...p, matchCount: 0 })));
  daemon.setPatterns(list);
  return { daemon, repository };
}

function usage(): void {
  printJson({
    usage: "cli <command> [args] [--flag value]",
    commands: [
      "generate <repoDir> [--threshold N] [--similarity X]",
      "ingest <message...>",
      "ingest-file <path>",
      "patterns",
      "stats",
      "serve [--port N]",
    ],
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const datastorePath = process.env.DATASTORE_PATH ?? defaultDatastorePath();
  const datastore = new Datastore(datastorePath);

  switch (command) {
    case "generate": {
      const repoDir = positional[0];
      if (!repoDir) {
        usage();
        process.exitCode = 1;
        return;
      }
      const generator = new SearchPatternGenerator(datastore);
      const result = generator.generateConfig(repoDir, {
        threshold: flags.threshold !== undefined ? Number(flags.threshold) : undefined,
        similarityThreshold:
          flags.similarity !== undefined ? Number(flags.similarity) : undefined,
      });
      printJson({
        repoDir: result.repoDir,
        loggingCallCount: result.loggingCalls.length,
        report: result.report,
        patterns: result.patterns,
        datastore: datastore.path,
      });
      return;
    }
    case "ingest": {
      const messages = positional;
      if (messages.length === 0) {
        usage();
        process.exitCode = 1;
        return;
      }
      const { daemon } = loadDaemon(datastore);
      printJson(messages.map((m) => ({ message: m, ...daemon.ingest(m) })));
      return;
    }
    case "ingest-file": {
      const file = positional[0];
      if (!file) {
        usage();
        process.exitCode = 1;
        return;
      }
      const lines = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const { daemon } = loadDaemon(datastore);
      const results = lines.map((m) => ({ message: m, ...daemon.ingest(m) }));
      printJson({
        matched: results.filter((r) => r.status === "matched").length,
        dropped: results.filter((r) => r.status === "dropped").length,
        results,
      });
      return;
    }
    case "patterns": {
      printJson(datastore.load().patterns);
      return;
    }
    case "stats": {
      const state = datastore.load();
      printJson({
        repoPath: state.repoPath,
        threshold: state.threshold,
        similarityCriterion: state.similarityCriterion,
        configuredPatterns: state.patterns.length,
        patternMatchCounts: Object.fromEntries(
          state.patterns.map((p) => [p.id, p.matchCount])
        ),
      });
      return;
    }
    case "serve": {
      const port = Number(flags.port ?? process.env.PORT ?? 3000);
      const app = buildServer(createContext(datastorePath));
      await app.listen({ port, host: "0.0.0.0" });
      // eslint-disable-next-line no-console
      console.log(`API ouvindo na porta ${port}`);
      return;
    }
    default:
      usage();
      if (command !== undefined) process.exitCode = 1;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
