#!/usr/bin/env node
/**
 * entity-assignment-debugger — interface de linha de comando (CLI).
 *
 * Comandos:
 *   debug --script s.json --ontology o.json --data d.csv [--format csv|json|text]
 *         [--delimiter ','] [--pattern '(?<nome>...)']
 *       Executa a operação de depuração (componente da patente US 9,984,152 B2
 *       implementado em src/core/debugger.ts) e imprime os resultados EXPRESSED.
 *   check-ontology --script s.json --ontology o.json
 *       Verifica a consistência atribuição×definição de todas as entidades e links.
 *   demo
 *       Demonstra o mecanismo central: a ontologia atribui "Endereco" como OBJETO
 *       enquanto o builder o define como PROPRIEDADE de "Pessoa" → resultado
 *       EXPRESSED indicando não-validade; em seguida, com a ontologia corrigida,
 *       o display recebe "transformation script has been validated".
 *   serve --port N
 *       Sobe o servidor HTTP (src/server/index.ts).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TransformationBuilder } from './core/builder.js';
import { dataSourceFromDescriptor, type DataSourceDescriptor } from './core/data-source.js';
import { ScriptDebugger, type DisplayDevice } from './core/debugger.js';
import { Ontology } from './core/ontology.js';
import { startServer } from './server/index.js';

type Out = (line: string) => void;

/** Display device da CLI: imprime no console apenas os resultados EXPRESSED. */
class ConsoleDisplayDevice implements DisplayDevice {
  constructor(private readonly out: Out) {}
  express(outcome: { message: string }): void {
    this.out(outcome.message);
  }
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith('--')) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`flag "${arg}" requer um valor`);
      }
      flags.set(arg.slice(2), value);
      i += 1;
    }
  }
  return flags;
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`flag obrigatória ausente: --${name}`);
  return value;
}

function buildSourceDescriptor(flags: Map<string, string>): DataSourceDescriptor {
  const format = (flags.get('format') ?? 'csv') as DataSourceDescriptor['type'];
  const content = readFileSync(requireFlag(flags, 'data'), 'utf8');
  const descriptor: DataSourceDescriptor = { type: format, content };
  const delimiter = flags.get('delimiter');
  if (delimiter !== undefined) descriptor.delimiter = delimiter;
  const pattern = flags.get('pattern');
  if (pattern !== undefined) descriptor.pattern = pattern;
  return descriptor;
}

function cmdDebug(args: string[], out: Out): number {
  const flags = parseFlags(args);
  const script = JSON.parse(readFileSync(requireFlag(flags, 'script'), 'utf8'));
  const ontology = Ontology.fromJSON(readFileSync(requireFlag(flags, 'ontology'), 'utf8'));
  const source = dataSourceFromDescriptor(buildSourceDescriptor(flags));
  const display = new ConsoleDisplayDevice(out);
  const report = new ScriptDebugger(display).run(script, ontology, source);
  for (const outcome of report.outcomes) {
    if (!outcome.expressed) {
      out(`[implicit] condição "${outcome.conditionId}" válida (resultado silencioso)`);
    }
  }
  out(report.success ? 'debug: SUCESSO' : 'debug: FALHA');
  return report.success ? 0 : 1;
}

function cmdCheckOntology(args: string[], out: Out): number {
  const flags = parseFlags(args);
  const script = JSON.parse(readFileSync(requireFlag(flags, 'script'), 'utf8'));
  const ontology = Ontology.fromJSON(readFileSync(requireFlag(flags, 'ontology'), 'utf8'));
  let allConsistent = true;
  for (const def of script.definitions ?? []) {
    const result = ontology.isConsistentWith(def);
    out(`${result.consistent ? 'OK  ' : 'ERRO'} entidade "${def.name}"`);
    for (const reason of result.reasons) out(`      - ${reason}`);
    allConsistent = allConsistent && result.consistent;
  }
  for (const link of script.links ?? []) {
    const result = ontology.isLinkConsistent(link);
    out(`${result.consistent ? 'OK  ' : 'ERRO'} link "${link.name}"`);
    for (const reason of result.reasons) out(`      - ${reason}`);
    allConsistent = allConsistent && result.consistent;
  }
  out(allConsistent ? 'ontologia consistente com o builder' : 'ontologia INCONSISTENTE com o builder');
  return allConsistent ? 0 : 1;
}

/**
 * Demo do mecanismo central: mesma definição no builder, duas atribuições
 * distintas na ontologia — primeiro inconsistente (invalid expressed), depois
 * consistente ("transformation script has been validated").
 */
function cmdDemo(out: Out): number {
  const script = new TransformationBuilder('demo')
    .defineObject('Pessoa', { nome: 'string' })
    .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
    .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
    .addCondition({ id: 'c1', entity: 'Endereco', dataItemId: 'row-1' })
    .build();

  const csv = 'nome\nAda Lovelace\n';

  out('--- Caso 1: ontologia atribui "Endereco" como OBJETO, builder define como PROPRIEDADE de "Pessoa" ---');
  const ontologiaInconsistente = new Ontology([
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'object', name: 'Endereco', properties: {} },
  ]);
  const report1 = new ScriptDebugger(new ConsoleDisplayDevice(out)).run(
    script,
    ontologiaInconsistente,
    dataSourceFromDescriptor({ type: 'csv', content: csv }),
  );
  out(`resultado: ${report1.success ? 'SUCESSO' : 'FALHA (como esperado)'}`);

  out('');
  out('--- Caso 2: ontologia corrigida — "Endereco" atribuído como PROPRIEDADE de "Pessoa" ---');
  const ontologiaCorrigida = new Ontology([
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
  ]);
  const report2 = new ScriptDebugger(new ConsoleDisplayDevice(out)).run(
    script,
    ontologiaCorrigida,
    dataSourceFromDescriptor({ type: 'csv', content: csv }),
  );
  out(`resultado: ${report2.success ? 'SUCESSO' : 'FALHA'}`);
  return report1.success === false && report2.success === true ? 0 : 1;
}

async function cmdServe(args: string[], out: Out): Promise<number> {
  const flags = parseFlags(args);
  const port = Number.parseInt(flags.get('port') ?? '0', 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port deve ser um inteiro entre 0 e 65535');
  }
  const started = await startServer(port);
  out(`servidor ouvindo em http://127.0.0.1:${started.port} (GET /health, POST /debug, POST /ontology/check)`);
  return 0;
}

const USAGE = `entity-assignment-debugger — CLI

Uso:
  entity-assignment-debugger debug --script s.json --ontology o.json --data d.csv [--format csv|json|text] [--delimiter ','] [--pattern REGEX]
  entity-assignment-debugger check-ontology --script s.json --ontology o.json
  entity-assignment-debugger demo
  entity-assignment-debugger serve --port N
`;

/** Ponto de entrada programável da CLI (testável): retorna o exit code. */
export async function run(argv: string[], out: Out = (l) => console.log(l)): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'debug':
      return cmdDebug(rest, out);
    case 'check-ontology':
      return cmdCheckOntology(rest, out);
    case 'demo':
      return cmdDemo(out);
    case 'serve':
      return cmdServe(rest, out);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      out(USAGE);
      return 0;
    default:
      out(`comando desconhecido: ${command}\n\n${USAGE}`);
      return 2;
  }
}

const invokedAsMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsMain) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    });
}
