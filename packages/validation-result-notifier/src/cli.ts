#!/usr/bin/env node
/**
 * validation-result-notifier — src/cli.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: interface de linha de comando sobre o núcleo de
 * validação proativa e a notificação multicanal — comandos:
 *   validate  valida script+ontologia+data source e entrega indicações expressed
 *   demo      2 condições inválidas entregues nos 3 canais × 4 formas (24 indicações)
 *   serve     sobe o servidor HTTP (porta efetiva exibida)
 */

import { readFile } from 'node:fs/promises';
import { CHANNEL_NAMES, createDefaultChannels, type ChannelName } from './core/channels.js';
import { ValidationNotifier } from './core/notifier.js';
import { RENDER_FORMS, type RenderForm } from './core/renderers.js';
import type { DataSourceSpec, OntologyParameter, TransformationScript } from './core/types.js';
import { importDataItems } from './core/validation.js';
import { startServer } from './server/index.js';

export interface CliIO {
  log(message: string): void;
  error(message: string): void;
}

const defaultIO: CliIO = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

interface ParsedFlags {
  positionals: string[];
  flags: Map<string, string>;
}

function parseFlags(argv: string[]): ParsedFlags {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next);
        i += 1;
      } else {
        flags.set(name, 'true');
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value === 'true') {
    throw new Error(`flag obrigatória ausente: --${name}`);
  }
  return value;
}

async function readJsonFile(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

interface ScriptFile {
  name?: string;
  entities?: TransformationScript['entities'];
  ontologyParameters?: OntologyParameter[];
  conditions: TransformationScript['conditions'];
}

interface OntologyFile {
  parameters?: OntologyParameter[];
}

/** Monta o transformation script a partir dos arquivos de script e ontologia. */
export function mergeScriptAndOntology(scriptFile: ScriptFile, ontologyFile: OntologyFile): TransformationScript {
  return {
    name: scriptFile.name ?? 'script-cli',
    entities: scriptFile.entities ?? [],
    ontologyParameters: [
      ...(scriptFile.ontologyParameters ?? []),
      ...(ontologyFile.parameters ?? []),
    ],
    conditions: scriptFile.conditions,
  };
}

async function cmdValidate(argv: string[], io: CliIO): Promise<number> {
  const { flags } = parseFlags(argv);
  const scriptPath = requireFlag(flags, 'script');
  const dataPath = requireFlag(flags, 'data');
  const ontologyPath = flags.get('ontology');

  const scriptFile = (await readJsonFile(scriptPath)) as ScriptFile;
  const ontologyFile: OntologyFile =
    ontologyPath !== undefined && ontologyPath !== 'true'
      ? ((await readJsonFile(ontologyPath)) as OntologyFile)
      : {};
  const script = mergeScriptAndOntology(scriptFile, ontologyFile);
  const dataSource = (await readJsonFile(dataPath)) as DataSourceSpec;

  const channel = flags.get('channel');
  const form = flags.get('form');
  if (channel !== undefined && !CHANNEL_NAMES.includes(channel as ChannelName)) {
    throw new Error(`canal inválido: ${channel} (use ${CHANNEL_NAMES.join('|')})`);
  }
  if (form !== undefined && !RENDER_FORMS.includes(form as RenderForm)) {
    throw new Error(`forma inválida: ${form} (use ${RENDER_FORMS.join('|')})`);
  }

  const defaults = createDefaultChannels();
  const notifier = new ValidationNotifier(defaults.channels);
  const output = notifier.run({
    script,
    dataItems: importDataItems(dataSource),
    notify: {
      ...(channel !== undefined ? { channel: channel as ChannelName } : {}),
      ...(form !== undefined ? { form: form as RenderForm } : {}),
    },
  });

  io.log(`script '${script.name}': ${output.results.length} resultado(s)`);
  for (const result of output.results) {
    io.log(`  [${result.kind}] condição '${result.verdict.conditionId}' válida=${result.verdict.valid}`);
  }
  io.log(`${output.delivered.length} indicação(ões) expressed entregue(s):`);
  for (const indication of output.delivered) {
    io.log(`  --- canal=${indication.channel} forma=${indication.form} severidade=${indication.severity}`);
    io.log(indication.content);
  }
  return output.delivered.length > 0 ? 0 : 0;
}

/** Script de demonstração: 2 condições inválidas + 1 válida final. */
export function buildDemoScript(): { script: TransformationScript; dataSource: DataSourceSpec } {
  const script: TransformationScript = {
    name: 'demo',
    entities: [
      { entity: 'Cliente', kind: 'object' },
      { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
    ],
    ontologyParameters: [
      { name: 'p-nome', defines: { entity: 'nome', kind: 'property', parentObject: 'Cliente' }, acceptedTypes: ['record'] },
      { name: 'p-cliente', defines: { entity: 'Cliente', kind: 'object' }, acceptedTypes: ['record'] },
    ],
    conditions: [
      {
        id: 'c-erro-entidade',
        description: 'atribuição inconsistente com a definição',
        assignment: { entity: 'nome', kind: 'object' },
        mappings: [],
      },
      {
        id: 'c-erro-mapping',
        description: 'mapping incompatível com o parâmetro',
        assignment: { entity: 'Cliente', kind: 'object' },
        mappings: [{ dataItemId: 'line-0', parameterName: 'p-cliente' }],
      },
      {
        id: 'c-ok',
        description: 'condição válida final',
        assignment: { entity: 'Cliente', kind: 'object' },
        mappings: [{ dataItemId: 'row-1', parameterName: 'p-cliente' }],
      },
    ],
  };
  const dataSource: DataSourceSpec = {
    format: 'csv',
    content: 'id,nome\nrow-1,Ada\nrow-2,Grace',
  };
  return { script, dataSource };
}

/** Demo: 2 condições inválidas entregues nos 3 canais × 4 formas = 24 indicações. */
async function cmdDemo(io: CliIO): Promise<number> {
  const { script, dataSource } = buildDemoScript();
  const dataItems = importDataItems(dataSource);
  let total = 0;
  for (const channel of CHANNEL_NAMES) {
    for (const form of RENDER_FORMS) {
      const defaults = createDefaultChannels();
      const notifier = new ValidationNotifier(defaults.channels);
      const output = notifier.run({ script, dataItems, notify: { channel, form } });
      const invalidDelivered = output.delivered.filter((d) => d.severity === 'error');
      total += invalidDelivered.length;
      io.log(`canal=${channel} forma=${form}: ${invalidDelivered.length} indicação(ões) de condição inválida`);
      for (const indication of invalidDelivered) {
        io.log(`  ${indication.conditionId} -> ${indication.content.split('\n')[0] ?? ''}`);
      }
    }
  }
  io.log(`total de indicações de condições inválidas entregues: ${total}`);
  return 0;
}

async function cmdServe(argv: string[], io: CliIO): Promise<number> {
  const { flags } = parseFlags(argv);
  const portFlag = flags.get('port');
  const port = portFlag !== undefined && portFlag !== 'true' ? Number.parseInt(portFlag, 10) : 0;
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`porta inválida: ${String(portFlag)}`);
  }
  const running = await startServer(port);
  io.log(`servidor validation-result-notifier ouvindo na porta ${running.port}`);
  io.log('rotas: GET /health · GET /channels · POST /validate');
  return 0;
}

const USAGE = [
  'uso: vrn <comando> [opções]',
  'comandos:',
  '  validate --script <arquivo.json> [--ontology <arquivo.json>] --data <fonte.json>',
  '           [--channel debugger|email|popup] [--form message|acronym|number|graphic]',
  '  demo     executa a demo: 2 condições inválidas × 3 canais × 4 formas',
  '  serve    [--port <n>] sobe o servidor HTTP (0 = porta efêmera)',
].join('\n');

/** Ponto de entrada testável da CLI: retorna o exit code. */
export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'validate':
        return await cmdValidate(rest, io);
      case 'demo':
        return await cmdDemo(io);
      case 'serve':
        return await cmdServe(rest, io);
      case 'help':
      case '--help':
      case undefined:
        io.log(USAGE);
        return command === undefined ? 1 : 0;
      default:
        io.error(`comando desconhecido: ${String(command)}`);
        io.log(USAGE);
        return 2;
    }
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
