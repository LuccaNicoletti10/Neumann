#!/usr/bin/env node
/**
 * schema-registry — src/cli.ts
 * demo: discover → register → add/remove/alter coluna (T1.4) → mapping assistido.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { discover, parseCsvSample } from './core/discover.js';
import { createDemoOntology, suggestMappings } from './core/mapping.js';
import { createSchemaRegistry } from './core/registry.js';
import { startServer } from './server/index.js';

const USAGE = `schema-registry — PASSO 7: registry + drift + discover (US 9,330,120)

Uso:
  schema-registry demo
  schema-registry serve [--port <n>]
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

function runDemo(log: (message: string) => void): number {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const registry = createSchemaRegistry({ clock, nextId });

  log('== 1. Discover (US 9,330,120) — schema de fonte nova a partir de CSV ==');
  const csv = [
    'id,first_name,last_name,email,age',
    '1,Ada,Lovelace,ada@example.com,36',
    '2,Alan,Turing,alan@example.com,41',
  ].join('\n');
  const rows = parseCsvSample(csv);
  const discovered = discover({ source: 'crm', object: 'people', rows });
  for (const col of discovered.columns) {
    log(
      `  coluna ${col.column}: ${col.physicalType}` +
        (col.semanticHint ? ` hint=${col.semanticHint}` : '') +
        (col.isPrimaryKey ? ' [PK]' : '') +
        (col.nullable ? ' nullable' : ' required'),
    );
  }

  log('== 2. Register no schema registry (versão 1) ==');
  const registered = registry.register(discovered);
  log(`  ${registered.schema.source}.${registered.schema.object} v${registered.schema.schemaVersion}`);

  log('== 3. Mapping assistido → ontologia ==');
  for (const s of suggestMappings(discovered.columns, createDemoOntology(), 5)) {
    log(`  ${s.column} → ${s.objectType}.${s.property} (score=${s.score}; ${s.reason})`);
  }

  log('== 4. T1.4 compatible — adicionar coluna nullable ==');
  const withCity = {
    ...discovered,
    columns: [
      ...discovered.columns,
      {
        column: 'city',
        physicalType: 'string' as const,
        nullable: true,
        sampleValues: ['London'],
      },
    ],
  };
  const compat = registry.observe(withCity);
  log(`  drift=${compat.report.kind} action=${compat.report.action} → v${compat.schema.schemaVersion}`);

  log('== 5. T1.4 coercible — widening integer → float ==');
  const widened = {
    ...withCity,
    columns: withCity.columns.map((c) =>
      c.column === 'age' ? { ...c, physicalType: 'float' as const } : c,
    ),
  };
  const coercible = registry.observe(widened);
  log(
    `  drift=${coercible.report.kind} action=${coercible.report.action} casts=${coercible.report.casts.length} → v${coercible.schema.schemaVersion}`,
  );

  log('== 6. T1.4 breaking — remover coluna → pause + alert ==');
  const removed = {
    ...widened,
    columns: widened.columns.filter((c) => c.column !== 'email'),
  };
  const breaking = registry.observe(removed);
  log(
    `  drift=${breaking.report.kind} action=${breaking.report.action} paused=${breaking.schema.paused}` +
      (breaking.alert ? ` alert=${breaking.alert.id}` : ''),
  );

  log('== 7. Estado final ==');
  log(`  alertas abertos: ${registry.listAlerts({ acknowledged: false }).length}`);
  log(`  casts registrados: ${registry.listCasts('crm', 'people').length}`);
  log(`  pausado: ${registry.isPaused('crm', 'people')}`);
  return 0;
}

export async function runCommandLine(
  argv: readonly string[] = [],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m: string): void => console.log(m));
  const error = deps.error ?? ((m: string): void => console.error(m));
  const args = argv.filter((a) => a !== '--');
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'demo':
        return runDemo(log);
      case 'serve': {
        const port = portFromFlags(rest) ?? 8080;
        const started = await startServer(port);
        log(
          `schema-registry ouvindo em http://localhost:${started.port} ` +
            '(GET /health, /schemas, /alerts; POST /schemas/register|observe|resume, /discover, /mappings/suggest)',
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
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
