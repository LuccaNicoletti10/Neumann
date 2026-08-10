#!/usr/bin/env node
/**
 * CLI do periodic-search-manager.
 *
 * Interface de linha de comando para os mecanismos implementados de forma
 * independente da patente US 10,572,487 B1 (Palantir): configurar buscas
 * periódicas sobre múltiplas fontes ("periodic search", "multiple data
 * sources"), executá-las sob demanda, injetar dados novos ("new-data
 * detection") e inspecionar alertas/resultados ("alert/notify",
 * "result storage").
 */

import { SearchManager, type CreateSearchInput } from './core/search-manager.js';
import {
  DataSourceRegistry,
  InMemoryDataSource,
  JsonFileDataSource,
  type DataRecord,
} from './core/data-source.js';
import { ConsoleNotifier, InMemoryTeamDirectory } from './core/alert-manager.js';
import type { ScheduleSpec } from './core/types.js';
import { startServer } from './server/index.js';

/** Converte duração textual ("60s", "5m", "2h", "1d" ou ms puros) em ms. */
export function parseDurationMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(input.trim());
  if (match === null) {
    throw new Error(`Duração inválida: "${input}" (use ex.: 500ms, 60s, 5m, 2h, 1d)`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1;
  return value * factor;
}

/** Monta ScheduleSpec a partir das flags do CLI. */
export function parseSchedule(args: ParsedArgs): ScheduleSpec {
  const every = args.flags['every'];
  const daily = args.flags['daily'];
  if (every !== undefined) {
    return { kind: 'interval', everyMs: parseDurationMs(every) };
  }
  if (daily !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(daily.trim());
    if (m === null) {
      throw new Error(`Horário diário inválido: "${daily}" (use HH:MM em UTC)`);
    }
    return { kind: 'daily', hourUtc: Number(m[1]), minuteUtc: Number(m[2]) };
  }
  throw new Error('Informe --every <duração> ou --daily <HH:MM>');
}

export interface ParsedArgs {
  command: string[];
  flags: Record<string, string>;
}

/**
 * Parser simples e determinístico: posicionais + flags `--chave valor` e
 * `--chave=valor`.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq >= 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          throw new Error(`Flag sem valor: ${token}`);
        }
        flags[token.slice(2)] = next;
        i += 1;
      }
    } else {
      command.push(token);
    }
  }
  return { command, flags };
}

const USAGE = `periodic-search-manager — CLI

Uso:
  psm serve --port 3000 [--data-dir DIR]
  psm source add --id s1 --name "Minha fonte" [--kind memory|jsonl] [--dir DIR]
  psm source add-record <sourceId> --json '{"recordId":"r1","timestamp":"...","content":{...}}'
  psm source list
  psm search create --name NOME --source s1,s2 --every 60s [--text "erro"] [--filter k=v,...] [--users u1,u2] [--teams t1]
  psm search run <id>
  psm search list
  psm alerts <searchId>

Flags globais: --data-dir DIR (default: ./psm-data ou env PSM_DATA_DIR)
`;

function resolveDataDir(flags: Record<string, string>): string {
  return flags['data-dir'] ?? process.env['PSM_DATA_DIR'] ?? './psm-data';
}

/** Executa o CLI. Retornado código de saída (0 = ok). */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  const { command, flags } = parsed;
  const dataDir = resolveDataDir(flags);

  if (command.length === 0 || command[0] === 'help' || command[0] === '--help') {
    console.log(USAGE);
    return 0;
  }

  if (command[0] === 'serve') {
    const port = Number(flags['port'] ?? '3000');
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Porta inválida: ${flags['port'] ?? ''}`);
    }
    await startServer({ dataDir, port, notifiers: [new ConsoleNotifier()] });
    return 0;
  }

  // Comandos abaixo operam sobre o dataDir local.
  const registry = new DataSourceRegistry();
  restoreMemorySources(registry, flags);
  const manager = new SearchManager({
    dataDir,
    registry,
    notifiers: [new ConsoleNotifier()],
    teamDirectory: new InMemoryTeamDirectory({}),
  });

  switch (command[0]) {
    case 'source': {
      return await handleSource(command.slice(1), flags, registry);
    }
    case 'search': {
      return await handleSearch(command.slice(1), flags, manager);
    }
    case 'alerts': {
      const searchId = command[1];
      if (searchId === undefined) throw new Error('Uso: psm alerts <searchId>');
      console.log(JSON.stringify(await manager.listAlerts(searchId), null, 2));
      return 0;
    }
    default:
      console.log(USAGE);
      return 1;
  }
}

/** Fontes em memória são efêmeras; --source regista fontes ad-hoc para o comando. */
function restoreMemorySources(registry: DataSourceRegistry, flags: Record<string, string>): void {
  const sources = flags['source-def'];
  if (sources === undefined) return;
  for (const entry of sources.split(',')) {
    const [id, name] = entry.split(':');
    if (id !== undefined && id !== '') {
      registry.register(new InMemoryDataSource(id, name ?? id));
    }
  }
}

async function handleSource(
  sub: string[],
  flags: Record<string, string>,
  registry: DataSourceRegistry,
): Promise<number> {
  switch (sub[0]) {
    case 'add': {
      const id = flags['id'];
      const name = flags['name'] ?? id;
      const kind = flags['kind'] ?? 'memory';
      if (id === undefined || name === undefined) {
        throw new Error('Uso: psm source add --id s1 --name "Fonte" [--kind memory|jsonl] [--dir DIR]');
      }
      if (kind === 'jsonl') {
        const dir = flags['dir'];
        if (dir === undefined) throw new Error('Fonte jsonl requer --dir DIR');
        registry.register(new JsonFileDataSource(id, name, dir));
      } else {
        registry.register(new InMemoryDataSource(id, name));
      }
      console.log(JSON.stringify({ id, name, kind, registered: true }));
      return 0;
    }
    case 'add-record': {
      const sourceId = sub[1];
      const json = flags['json'];
      if (sourceId === undefined || json === undefined) {
        throw new Error(`Uso: psm source add-record <sourceId> --json '{...}'`);
      }
      let source = registry.has(sourceId) ? registry.get(sourceId) : undefined;
      if (source === undefined) {
        // Registra fonte em memória ad-hoc para conveniência do CLI.
        source = new InMemoryDataSource(sourceId, sourceId);
        registry.register(source);
      }
      if (!(source instanceof InMemoryDataSource)) {
        throw new Error(`Fonte ${sourceId} não aceita injeção de registros`);
      }
      const parsed = JSON.parse(json) as Partial<DataRecord>;
      if (typeof parsed.recordId !== 'string' || typeof parsed.timestamp !== 'string') {
        throw new Error('O JSON deve conter recordId e timestamp (strings)');
      }
      const record: DataRecord = {
        recordId: parsed.recordId,
        sourceId,
        timestamp: parsed.timestamp,
        content: (parsed.content ?? {}) as Record<string, unknown>,
      };
      source.append([record]);
      console.log(JSON.stringify(record));
      return 0;
    }
    case 'list': {
      console.log(
        JSON.stringify(
          registry.list().map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
          null,
          2,
        ),
      );
      return 0;
    }
    default:
      throw new Error(`Subcomando de source desconhecido: ${sub[0] ?? ''}`);
  }
}

async function handleSearch(
  sub: string[],
  flags: Record<string, string>,
  manager: SearchManager,
): Promise<number> {
  switch (sub[0]) {
    case 'create': {
      const name = flags['name'];
      const sourceCsv = flags['source'];
      if (name === undefined || sourceCsv === undefined) {
        throw new Error('Uso: psm search create --name NOME --source s1,s2 --every 60s');
      }
      const input: CreateSearchInput = {
        name,
        dataSourceIds: sourceCsv.split(',').map((s) => s.trim()).filter((s) => s !== ''),
        schedule: parseSchedule({ command: [], flags }),
        ...(flags['text'] !== undefined ? { query: { text: flags['text'] } } : {}),
        ...(flags['users'] !== undefined
          ? { recipientUserIds: flags['users'].split(',').map((s) => s.trim()) }
          : {}),
        ...(flags['teams'] !== undefined
          ? { teamIds: flags['teams'].split(',').map((s) => s.trim()) }
          : {}),
      };
      const search = await manager.createSearch(input);
      console.log(JSON.stringify(search, null, 2));
      return 0;
    }
    case 'run': {
      const id = sub[1];
      if (id === undefined) throw new Error('Uso: psm search run <id>');
      const run = await manager.runNow(id);
      console.log(JSON.stringify(run, null, 2));
      return 0;
    }
    case 'list': {
      console.log(JSON.stringify(await manager.listSearches(), null, 2));
      return 0;
    }
    default:
      throw new Error(`Subcomando de search desconhecido: ${sub[0] ?? ''}`);
  }
}

// Execução direta (node dist/cli.js ou tsx src/cli.ts).
const isDirectRun = process.argv[1] !== undefined &&
  (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts'));
if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error('Erro:', err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}