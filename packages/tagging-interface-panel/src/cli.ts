#!/usr/bin/env node
/**
 * tagging-interface-panel — src/cli.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: ENTRYPOINT
 * DA LINHA DE COMANDO — runCommandLine(argv, deps) puro e testável (stdout
 * injetável) com o comando `demo`, que executa o fluxo completo do painel no
 * estilo do FIG. 4 (selecionar "Curiosity" → auto-fill TITLE/TYPE → object
 * tag → tagged objects → property tag vinculada → link tag entre 2 objetos →
 * search + sync → export com pares impressos), além do comando `serve`.
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWithDefinitions } from './core/parser.js';
import { gatherParameterValuePairs } from './core/pairs.js';
import {
  createDemoInternalDatabase,
  createDemoOntology,
  TaggingInterfacePanel,
} from './core/panel.js';
import { createIdGenerator, createStepClock } from './core/types.js';
import { startServer } from './server/index.js';

const USAGE = `tagging-interface-panel — painel de tagging interface sobre conteúdo externo

Uso:
  tagging-interface-panel demo
  tagging-interface-panel serve [--port <n>]
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

function printPairs(log: (m: string) => void, tagId: string, pairsTitle: string, tag: Parameters<typeof gatherParameterValuePairs>[0]): void {
  log(`${pairsTitle} (${tagId}):`);
  for (const pair of gatherParameterValuePairs(tag)) {
    log(`    ${pair.parameter}: ${pair.value}`);
  }
}

/** Fluxo completo de demonstração, determinístico (FIG. 4 adaptado). */
function runDemo(log: (message: string) => void): number {
  const ontology = createDemoOntology();
  const panel = new TaggingInterfacePanel(ontology, {
    clock: createStepClock('2014-09-18T12:00:00.000Z', 60_000),
    newId: createIdGenerator(),
    user: 'analista',
    loggedIn: true,
    internalDb: createDemoInternalDatabase(),
  });

  log('== 1. Seleção de porção do conteúdo externo ==');
  const selection = panel.select({
    contentKind: 'text',
    content: 'O rover Curiosity segue viagem em Marte usando ground travel.',
    portion: 'Curiosity',
  });
  for (const field of selection.fields) {
    log(`  ${field.id} = ${field.value ?? ''}`);
  }
  log(`  conteúdo armazenado sob o label: ${selection.contentLabel}`);

  log('== 2. Object tag (406) via Create Tag button (414) ==');
  panel.chooseOption('object');
  const tag1 = panel.createTag();
  log(`  tag criada: ${tag1.id} "${tag1.title}" : ${tag1.type}`);

  log('== 3. Segundo object tag (para a link tag) ==');
  panel.select({
    contentKind: 'text',
    content: 'A aeronave Odyssey fará o flight de retorno na sexta-feira.',
    portion: 'Odyssey flight',
  });
  panel.chooseOption('object');
  const tag2 = panel.createTag();
  log(`  tag criada: ${tag2.id} "${tag2.title}" : ${tag2.type}`);

  log('== 4. Property tag (404) vinculada a um objeto tagueado ==');
  const parsed = parseWithDefinitions(ontology.parserDefinitions, 'Smith, Jane');
  for (const match of parsed) {
    log(`  parser "${match.definitionName}": ${JSON.stringify(match.mapped)}`);
  }
  panel.select({
    contentKind: 'text',
    content: 'Manifesto de passageiros: Smith, Jane — assento 12A.',
    portion: 'Smith, Jane',
  });
  panel.chooseOption('property');
  const alvo = panel.objectsField.selectForPropertyLink(tag1.id);
  const propTag = panel.createTag({
    title: 'Smith, Jane',
    type: 'Name',
    targetObjectIds: [alvo.id],
  });
  log(`  property tag ${propTag.id} "${propTag.title}" vinculada a ${alvo.id}`);

  log('== 5. Link tag (408) entre 2 objetos do tagged objects field (418) ==');
  const selecionados = panel.objectsField.selectForLink([tag1.id, tag2.id]);
  panel.chooseOption('link');
  const linkTag = panel.createTag({
    title: 'Curiosity ↔ Odyssey',
    type: 'Vehicle',
    targetObjectIds: selecionados.map((t) => t.id),
  });
  log(`  link tag ${linkTag.id} entre ${selecionados.map((t) => t.id).join(' e ')}`);

  log('== 6. TYPE modificável após a criação (Ground Travel → Air Travel) ==');
  const modificado = panel.modifyTag(tag1.id, { type: 'Air Travel' });
  log(`  ${modificado.id}: TYPE agora é "${modificado.type}"`);

  log('== 7. Search for object (416) + SYNC no internal database ==');
  const results = panel.search('Curiosity');
  log(`  ${results.length} resultado(s) para "Curiosity"`);
  const primeiro = results[0];
  if (primeiro !== undefined) {
    const synced = panel.sync(tag1.id, primeiro.objectId);
    log(`  sync: ${synced.tagId} ⇢ ${synced.syncedObjectId ?? ''}`);
  }

  log('== 8. Export to Internal DB (420) — pares parâmetro-valor ==');
  const exported = panel.export('both');
  for (const tag of exported.tags) {
    printPairs(log, tag.id, '  pares', tag);
  }
  log(`  destino: ${exported.destination} | registros convertidos: ${exported.converted.length}`);

  log('== Painel final ==');
  log(panel.renderPanel());
  return 0;
}

/** Ponto de entrada programático da CLI (testável, sem process.exit). */
export async function runCommandLine(
  argv: readonly string[],
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
          `tagging-interface-panel ouvindo em http://localhost:${started.port} ` +
            '(GET /health, POST /panel/select, POST /panel/options, POST /panel/tags, ' +
            'GET /panel/tagged-objects, POST /panel/search, POST /panel/sync, POST /panel/export)',
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
