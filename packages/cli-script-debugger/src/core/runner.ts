/**
 * cli-script-debugger — src/core/runner.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: OPERAÇÃO DE DEBUGGING INICIADA PELA
 * LINHA DE COMANDO — runCommandLine(argv) faz o parse dos argumentos, carrega
 * o arquivo de configuração (que identifica o ontology file), resolve os
 * caminhos relativos ao config, importa os data items, executa o debug no
 * modo eager ou lazy e emite as indicações. Núcleo puro e testável: fs apenas
 * na borda via dependências injetáveis e SEM process.exit.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parseScript } from './builder.js';
import type { ScriptDefinition } from './types.js';
import { parseConfigFile, resolveConfigPaths } from './config.js';
import { createSinkFor, dispatchIndication } from './indication.js';
import type { IndicationSink } from './indication.js';
import { parseOntology } from './ontology.js';
import { importCsv, importText, Validator } from './validator.js';
import type {
  AssociationMode,
} from './validator.js';
import type {
  DataItem,
  DebugConfig,
  Indication,
  IndicationForm,
  Verdict,
} from './types.js';

/** Dependências injetáveis do runner (fs/saída ficam na borda). */
export interface RunnerDeps {
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  /** Sinks explícitos; se ausentes, usa-se onIndication com o canal do config. */
  sinks?: IndicationSink[];
  /** Callback de entrega quando sinks não são passados explicitamente. */
  onIndication?: (indication: Indication) => void;
}

/** Resultado puro da linha de comando (sem process.exit). */
export interface RunResult {
  exitCode: number;
  verdict?: Verdict;
  indications: Indication[];
  errors: string[];
}

interface DebugExecutionConfig {
  mode: AssociationMode;
  indication: { form: IndicationForm };
}

/**
 * Pipeline de debug reutilizável (usado pelo runner CLI e pelo servidor HTTP):
 * no modo EAGER a ontologia é carregada ANTES do run; no modo LAZY o loader só
 * é invocado durante o debugging, no primeiro uso, com cache.
 */
export function executeDebug(
  script: ScriptDefinition,
  items: readonly DataItem[],
  config: DebugExecutionConfig,
  deps: { loadOntology: () => string; sinks?: readonly IndicationSink[] },
): { verdict: Verdict; indication: Indication } {
  let validator: Validator;
  if (config.mode === 'lazy') {
    validator = new Validator(script, {
      mode: 'lazy',
      loader: () => parseOntology(deps.loadOntology()),
    });
  } else {
    const ontology = parseOntology(deps.loadOntology());
    validator = new Validator(script, { mode: 'eager', ontology });
  }
  const verdict = validator.run(items);
  const indication = dispatchIndication(verdict, config.indication.form, deps.sinks ?? []);
  return { verdict, indication };
}

const FORMS: readonly IndicationForm[] = ['message', 'acronym', 'number', 'graphic'];

const EXAMPLE_CONFIG = {
  scriptFile: './script.json',
  ontologyFile: './ontologia.json',
  dataFile: './dados.csv',
  dataFormat: 'csv',
  mode: 'eager',
  indication: { form: 'message', sink: 'debugger' },
} as const;

interface ParsedArgs {
  flags: Map<string, string>;
  positionals: string[];
}

function parseArgv(args: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(arg.slice(2), next);
        i += 1;
      } else {
        flags.set(arg.slice(2), 'true');
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

/**
 * Entrypoint testável da linha de comando: executa o script pela CLI e
 * devolve o resultado puro (exitCode + veredito + indicações), sem encerrar
 * o processo.
 */
export function runCommandLine(argv: readonly string[], deps: RunnerDeps = {}): RunResult {
  const readFile = deps.readFile ?? ((p: string): string => readFileSync(p, 'utf8'));
  const writeFile =
    deps.writeFile ?? ((p: string, c: string): void => writeFileSync(p, c, 'utf8'));
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'debug':
        return runDebug(rest, { readFile, sinks: deps.sinks, onIndication: deps.onIndication });
      case 'init-config':
        return runInitConfig(rest, writeFile);
      default:
        return {
          exitCode: 2,
          indications: [],
          errors: [`comando desconhecido: ${command ?? '(vazio)'} — use "debug" ou "init-config"`],
        };
    }
  } catch (error) {
    return {
      exitCode: 2,
      indications: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

interface DebugDeps {
  readFile: (path: string) => string;
  sinks?: IndicationSink[];
  onIndication?: (indication: Indication) => void;
}

function runDebug(args: readonly string[], deps: DebugDeps): RunResult {
  const { flags } = parseArgv(args);
  const configPath = flags.get('config');
  if (configPath === undefined) {
    return {
      exitCode: 2,
      indications: [],
      errors: [
        'uso: debug --config <debug.config.json> [--mode eager|lazy] [--form message|acronym|number|graphic]',
      ],
    };
  }
  const modeOverride = flags.get('mode');
  if (modeOverride !== undefined && modeOverride !== 'eager' && modeOverride !== 'lazy') {
    return { exitCode: 2, indications: [], errors: ['--mode deve ser "eager" ou "lazy"'] };
  }
  const formOverride = flags.get('form');
  if (formOverride !== undefined && !FORMS.includes(formOverride as IndicationForm)) {
    return { exitCode: 2, indications: [], errors: [`--form deve ser um de ${FORMS.join(', ')}`] };
  }

  // 1) Carrega o arquivo de configuração, que IDENTIFICA o ontology file.
  const configFile = parseConfigFile(deps.readFile(configPath));
  // 2) Resolve os caminhos relativos ao diretório do próprio config.
  const config: DebugConfig = resolveConfigPaths(configFile, dirname(configPath));
  if (modeOverride !== undefined) config.mode = modeOverride;
  if (formOverride !== undefined) {
    config.indication = { ...config.indication, form: formOverride as IndicationForm };
  }

  // 3) Resolve script e dados; a ontologia fica a cargo do modo (eager/lazy).
  const script = parseScript(deps.readFile(config.scriptFile));
  const dataText = deps.readFile(config.dataFile);
  const items = config.dataFormat === 'csv' ? importCsv(dataText) : importText(dataText);

  const sinks =
    deps.sinks ??
    (deps.onIndication !== undefined
      ? [createSinkFor(config.indication.sink, deps.onIndication)]
      : []);

  // 4) Executa o debug e emite a indicação do resultado.
  const { verdict, indication } = executeDebug(script, items, config, {
    loadOntology: () => deps.readFile(config.ontologyFile),
    sinks,
  });
  return { exitCode: verdict.valid ? 0 : 1, verdict, indications: [indication], errors: [] };
}

function runInitConfig(
  args: readonly string[],
  writeFile: (path: string, content: string) => void,
): RunResult {
  const { positionals } = parseArgv(args);
  const target = positionals[0] ?? 'debug.config.json';
  writeFile(target, JSON.stringify(EXAMPLE_CONFIG, null, 2) + '\n');
  return { exitCode: 0, indications: [], errors: [] };
}
