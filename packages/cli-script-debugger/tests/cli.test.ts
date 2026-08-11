/**
 * cli-script-debugger — tests/cli.test.ts
 * Testa o entrypoint da CLI (debug, init-config, demo) de forma programática,
 * sem process.exit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { main } from '../src/cli.js';
import { serializeScript } from '../src/core/builder.js';
import { makeTempDir, sampleCsv, sampleOntology, sampleScript, writeFile } from './helpers.js';

describe('CLI', () => {
  it('init-config gera arquivo de exemplo', async () => {
    const dir = makeTempDir();
    const target = join(dir, 'debug.config.json');
    const logs: string[] = [];
    const code = await main(['init-config', target], { log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(existsSync(target)).toBe(true);
    const config = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    expect(config['ontologyFile']).toBe('./ontologia.json');
    expect(logs.some((m) => m.includes('configuração'))).toBe(true);
  });

  it('debug --config executa e emite indicação no log', async () => {
    const dir = makeTempDir();
    writeFile(dir, 'script.json', serializeScript(sampleScript()));
    writeFile(dir, 'ontologia.json', JSON.stringify(sampleOntology()));
    writeFile(dir, 'dados.csv', sampleCsv());
    const configPath = writeFile(
      dir,
      'debug.config.json',
      JSON.stringify({
        scriptFile: './script.json',
        ontologyFile: './ontologia.json',
        dataFile: './dados.csv',
        dataFormat: 'csv',
      }),
    );
    const logs: string[] = [];
    const code = await main(['debug', '--config', configPath], { log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(logs.some((m) => m.includes('indicação'))).toBe(true);
  });

  it('debug inválido retorna código 1', async () => {
    const dir = makeTempDir();
    writeFile(dir, 'script.json', serializeScript(sampleScript()));
    const ontology = sampleOntology();
    ontology.parameters[0] = {
      name: 'personId',
      entity: 'pessoa',
      assignment: { kind: 'property', objectType: 'Person', property: 'id' },
    };
    writeFile(dir, 'ontologia.json', JSON.stringify(ontology));
    writeFile(dir, 'dados.csv', sampleCsv());
    const configPath = writeFile(
      dir,
      'debug.config.json',
      JSON.stringify({
        scriptFile: './script.json',
        ontologyFile: './ontologia.json',
        dataFile: './dados.csv',
        dataFormat: 'csv',
      }),
    );
    const code = await main(['debug', '--config', configPath], {
      log: () => undefined,
      error: () => undefined,
    });
    expect(code).toBe(1);
  });

  it('demo executa cenário completo com sucesso', async () => {
    const logs: string[] = [];
    const code = await main(['demo'], { log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(logs.some((m) => m.includes('exitCode=0'))).toBe(true);
  });

  it('sem comando exibe uso e retorna 0', async () => {
    const logs: string[] = [];
    const code = await main([], { log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(logs.some((m) => m.includes('Uso'))).toBe(true);
  });

  it('comando desconhecido retorna 2', async () => {
    const errors: string[] = [];
    const code = await main(['foo'], { error: (m) => errors.push(m), log: () => undefined });
    expect(code).toBe(2);
    expect(errors.length).toBeGreaterThan(0);
  });
});
