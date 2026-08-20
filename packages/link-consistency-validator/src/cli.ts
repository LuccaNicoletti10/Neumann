#!/usr/bin/env node
/**
 * link-consistency-validator — interface de linha de comando.
 *
 * CLI sobre os mecanismos da patente US 8,930,897 B2 reimplementados no núcleo:
 *   validate --script f.dsl --ontology o.json --data d.csv [--format text|json]
 *           [--data-format csv|text] [--pattern REGEX] [--data-fields a,b]
 *   parse f.dsl
 *   demo            (script + ontologia com link inconsistente embutidos,
 *                    mostrando o fluxo expressed/implicit)
 *   serve [--port N] [--host H]
 */
import { readFile } from 'node:fs/promises';
import { ScriptBuilder } from './core/builder.js';
import { importDataItems, type DataSourceConfig } from './core/data-source.js';
import { Ontology } from './core/ontology.js';
import { StreamDisplayDevice, type ValidationResult } from './core/types.js';
import { ScriptValidator } from './core/validator.js';
import { startServer } from './server/index.js';

export interface CliIO {
  stdout(message: string): void;
  stderr(message: string): void;
  readFile(path: string): Promise<string>;
}

const defaultIO: CliIO = {
  stdout: (m) => process.stdout.write(`${m}\n`),
  stderr: (m) => process.stderr.write(`${m}\n`),
  readFile: (path) => readFile(path, 'utf8'),
};

const USAGE = `uso:
  link-consistency-validator validate --script <f.dsl> --ontology <o.json> --data <arquivo>
      [--data-format csv|text] [--pattern <regex>] [--data-fields a,b,c] [--format text|json]
  link-consistency-validator parse <f.dsl>
  link-consistency-validator demo
  link-consistency-validator serve [--port N] [--host H]`;

function optionValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function printResults(results: ValidationResult[], io: CliIO): void {
  for (const r of results) {
    io.stdout(`[${r.kind.toUpperCase()}] condição "${r.conditionName}": ${r.message}`);
  }
}

function parseDataSource(args: string[], content: string): DataSourceConfig {
  const format = optionValue(args, '--data-format') ?? (optionValue(args, '--data')?.endsWith('.csv') ? 'csv' : undefined);
  if (format === 'csv') {
    return { type: 'csv', content };
  }
  if (format === 'text') {
    const pattern = optionValue(args, '--pattern');
    if (!pattern) throw new Error('--pattern é obrigatório para --data-format text');
    const fields = optionValue(args, '--data-fields')?.split(',').map((f) => f.trim());
    return { type: 'text', content, pattern, ...(fields !== undefined ? { fields } : {}) };
  }
  throw new Error('informe --data-format csv|text (ou use arquivo .csv)');
}

async function cmdValidate(args: string[], io: CliIO): Promise<number> {
  const scriptPath = optionValue(args, '--script');
  const ontologyPath = optionValue(args, '--ontology');
  const dataPath = optionValue(args, '--data');
  if (!scriptPath || !ontologyPath || !dataPath) {
    io.stderr('validate exige --script, --ontology e --data');
    return 2;
  }
  const script = await io.readFile(scriptPath);
  const ontologyRaw = await io.readFile(ontologyPath);
  const dataContent = await io.readFile(dataPath);
  const builder = ScriptBuilder.fromDsl(script);
  const ontology = Ontology.fromJson(ontologyRaw);
  const items = importDataItems(parseDataSource(args, dataContent));
  const display = new StreamDisplayDevice((m) => io.stdout(`DISPLAY: ${m}`));
  const results = new ScriptValidator(ontology, display).debug(builder, items);
  const format = optionValue(args, '--format') ?? 'text';
  if (format === 'json') {
    io.stdout(JSON.stringify(results, null, 2));
  } else {
    printResults(results, io);
  }
  return results.every((r) => r.valid) ? 0 : 1;
}

async function cmdParse(args: string[], io: CliIO): Promise<number> {
  const scriptPath = args[0];
  if (!scriptPath) {
    io.stderr('parse exige o caminho do arquivo .dsl');
    return 2;
  }
  const builder = ScriptBuilder.fromDsl(await io.readFile(scriptPath));
  io.stdout(
    JSON.stringify(
      { entities: builder.entities, links: builder.links, conditions: builder.conditions },
      null,
      2,
    ),
  );
  return 0;
}

const DEMO_SCRIPT = `# script de transformação de demonstração
object Pessoa
object Empresa
property Pessoa.nome: string
property Empresa.razao_social: string

# builder CRIA os dois links abaixo
link Pessoa --trabalha_em--> Empresa
link Pessoa --emprega--> Empresa

condition c1 Pessoa --trabalha_em--> Empresa uses csv-1
condition c2 Pessoa --emprega--> Empresa uses csv-2
`;

const DEMO_ONTOLOGY = JSON.stringify(
  {
    entities: [
      { kind: 'object', name: 'Pessoa' },
      { kind: 'object', name: 'Empresa' },
      { kind: 'property', name: 'nome', parent: 'Pessoa', dataType: 'string' },
      { kind: 'property', name: 'razao_social', parent: 'Empresa', dataType: 'string' },
    ],
    links: [
      { from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' },
      // ontologia ATRIBUI o link com direção invertida em relação ao builder:
      { from: 'Empresa', predicate: 'emprega', to: 'Pessoa' },
    ],
  },
  null,
  2,
);

const DEMO_CSV = `id,nome,empresa
csv-1,Ana,ACME
csv-2,Bruno,ACME
`;

async function cmdDemo(io: CliIO): Promise<number> {
  io.stdout('=== DEMO: script de transformação ===');
  io.stdout(DEMO_SCRIPT);
  io.stdout('=== DEMO: parâmetros de ontologia ===');
  io.stdout(DEMO_ONTOLOGY);
  io.stdout('=== DEMO: operação de depuração ===');
  const builder = ScriptBuilder.fromDsl(DEMO_SCRIPT);
  const ontology = Ontology.fromJson(DEMO_ONTOLOGY);
  const items = importDataItems({ type: 'csv', content: DEMO_CSV, idColumn: 'id' });
  const display = new StreamDisplayDevice((m) => io.stdout(`DISPLAY: ${m}`));
  const results = new ScriptValidator(ontology, display).debug(builder, items);
  printResults(results, io);
  return results.every((r) => r.valid) ? 0 : 1;
}

async function cmdServe(args: string[], io: CliIO): Promise<number> {
  const port = Number(optionValue(args, '--port') ?? '0');
  const host = optionValue(args, '--host') ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr('--port deve ser um inteiro entre 0 e 65535');
    return 2;
  }
  const running = await startServer(port, host);
  io.stdout(`servidor ouvindo em http://${host}:${running.port} (GET /health, POST /validate, POST /parse-dsl)`);
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => resolve());
    process.on('SIGTERM', () => resolve());
  });
  await running.close();
  return 0;
}

/** Ponto de entrada testável: retorna o código de saída. */
export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'validate':
        return await cmdValidate(args, io);
      case 'parse':
        return await cmdParse(args, io);
      case 'demo':
        return await cmdDemo(io);
      case 'serve':
        return await cmdServe(args, io);
      case '--help':
      case '-h':
      case undefined:
        io.stdout(USAGE);
        return command === undefined ? 2 : 0;
      default:
        io.stderr(`comando desconhecido: "${String(command)}"`);
        io.stderr(USAGE);
        return 2;
    }
  } catch (err) {
    io.stderr(`erro: ${(err as Error).message}`);
    return 1;
  }
}

// Execução direta (node dist/cli.js ou tsx src/cli.ts).
const invokedAsScript = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedAsScript) {
  void runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
      process.exitCode = 1;
    },
  );
}
