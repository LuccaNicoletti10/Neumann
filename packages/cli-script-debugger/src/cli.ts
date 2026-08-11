#!/usr/bin/env node
/**
 * cli-script-debugger — src/cli.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: ENTRYPOINT DA LINHA DE COMANDO — a
 * operação de debugging do transformation script é INICIADA executando o
 * script pela CLI (`debug --config debug.config.json [--mode eager|lazy]`),
 * além dos comandos auxiliares `init-config`, `demo` e `serve`.
 */

import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScriptBuilder } from './core/builder.js';
import { runCommandLine } from './core/runner.js';
import type { Indication } from './core/types.js';
import { startServer } from './server/index.js';

const USAGE = `cli-script-debugger — depura transformation scripts pela linha de comando

Uso:
  cli-script-debugger debug --config <debug.config.json> [--mode eager|lazy] [--form message|acronym|number|graphic]
  cli-script-debugger init-config [caminho]
  cli-script-debugger demo
  cli-script-debugger serve [--port <n>]
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

function portFromFlags(args: readonly string[]): number | undefined {
  const index = args.indexOf('--port');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port deve ser um inteiro entre 0 e 65535');
  }
  return port;
}

/** Monta um cenário de demonstração determinístico em diretório temporário. */
function runDemo(log: (message: string) => void): number {
  const dir = mkdtempSync(join(tmpdir(), 'cli-script-debugger-demo-'));
  const script = createScriptBuilder('demo')
    .defineObject('pessoa', 'Person')
    .defineProperty('pessoaNome', 'Person', 'name')
    .addMapping({ entity: 'pessoa', dataField: 'id', parameter: 'personId' })
    .addMapping({ entity: 'pessoaNome', dataField: 'nome', parameter: 'personName' })
    .addCondition({ dataSource: 'id', type: 'fieldPresent' })
    .toJSON();
  const ontology = JSON.stringify(
    {
      name: 'demo-ontology',
      parameters: [
        { name: 'personId', entity: 'pessoa', assignment: { kind: 'object', objectType: 'Person' } },
        {
          name: 'personName',
          entity: 'pessoaNome',
          assignment: { kind: 'property', objectType: 'Person', property: 'name' },
        },
      ],
    },
    null,
    2,
  );
  const data = 'id,nome\n1,Ada\n2,Grace\n';
  const config = JSON.stringify(
    {
      scriptFile: './script.json',
      ontologyFile: './ontologia.json',
      dataFile: './dados.csv',
      dataFormat: 'csv',
      mode: 'eager',
      indication: { form: 'message', sink: 'debugger' },
    },
    null,
    2,
  );
  writeFileSync(join(dir, 'script.json'), script);
  writeFileSync(join(dir, 'ontologia.json'), ontology);
  writeFileSync(join(dir, 'dados.csv'), data);
  const configPath = join(dir, 'debug.config.json');
  writeFileSync(configPath, config);
  log(`demo: cenário criado em ${dir}`);
  const result = runCommandLine(['debug', '--config', configPath], {
    onIndication: (i) => log(`indicação [${i.kind}/${i.form}] ${i.content}`),
  });
  for (const error of result.errors) log(`erro: ${error}`);
  log(`demo: exitCode=${result.exitCode}`);
  return result.exitCode;
}

/** Ponto de entrada programático da CLI (testável, sem process.exit). */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m: string): void => console.log(m));
  const error = deps.error ?? ((m: string): void => console.error(m));
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'debug':
      case 'init-config': {
        const result = runCommandLine(argv, {
          onIndication: (i: Indication) => log(`indicação [${i.kind}/${i.form}] ${i.content}`),
        });
        for (const e of result.errors) error(`erro: ${e}`);
        if (command === 'init-config' && result.exitCode === 0) {
          log('arquivo de configuração de exemplo gerado');
        }
        return result.exitCode;
      }
      case 'demo':
        return runDemo(log);
      case 'serve': {
        const port = portFromFlags(rest) ?? 8080;
        const started = await startServer(port);
        log(
          `cli-script-debugger ouvindo em http://localhost:${started.port} ` +
            '(GET /health, POST /debug)',
        );
        return 0;
      }
      case undefined:
        log(USAGE);
        return 0;
      default:
        error(USAGE);
        return 2;
    }
  } catch (err) {
    error(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
