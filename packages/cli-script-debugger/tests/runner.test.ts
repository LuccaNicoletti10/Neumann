/**
 * cli-script-debugger — tests/runner.test.ts
 * Testa runCommandLine de ponta a ponta com arquivos temporários: o config
 * identifica o ontology file por caminho relativo, os modos eager/lazy são
 * honrados e as indicações são emitidas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCommandLine } from '../src/core/runner.js';
import type { Indication } from '../src/core/types.js';
import { serializeScript } from '../src/core/builder.js';
import { makeTempDir, sampleCsv, sampleOntology, sampleScript, writeFile } from './helpers.js';

function setupScenario(dir: string, configExtra: Record<string, unknown> = {}): string {
  writeFile(dir, 'script.json', serializeScript(sampleScript()));
  writeFile(dir, 'ontologia.json', JSON.stringify(sampleOntology()));
  writeFile(dir, 'dados.csv', sampleCsv());
  return writeFile(
    dir,
    'debug.config.json',
    JSON.stringify({
      scriptFile: './script.json',
      ontologyFile: './ontologia.json',
      dataFile: './dados.csv',
      dataFormat: 'csv',
      ...configExtra,
    }),
  );
}

describe('runCommandLine — debug end-to-end', () => {
  it('executa o debug via config que identifica o ontology file (caminho relativo)', () => {
    const dir = makeTempDir();
    const configPath = setupScenario(dir);
    const captured: Indication[] = [];
    const result = runCommandLine(['debug', '--config', configPath], {
      sinks: [{ channel: 'debugger', deliver: (i) => captured.push(i) }],
    });
    expect(result.exitCode).toBe(0);
    expect(result.verdict?.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.indications).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe('implicit');
  });

  it('modo lazy via --mode: ontologia lida uma única vez, durante o run', () => {
    const dir = makeTempDir();
    const configPath = setupScenario(dir);
    const ontologyPath = join(dir, 'ontologia.json');
    let ontologyReads = 0;
    const result = runCommandLine(['debug', '--config', configPath, '--mode', 'lazy'], {
      readFile: (p) => {
        if (p === ontologyPath) ontologyReads += 1;
        return readFileSync(p, 'utf8');
      },
    });
    expect(result.exitCode).toBe(0);
    expect(ontologyReads).toBe(1);
  });

  it('modo lazy via campo "mode" do config', () => {
    const dir = makeTempDir();
    const configPath = setupScenario(dir, { mode: 'lazy' });
    const result = runCommandLine(['debug', '--config', configPath]);
    expect(result.exitCode).toBe(0);
    expect(result.verdict?.valid).toBe(true);
  });

  it('exitCode 1 e indicação expressa quando o script é inválido', () => {
    const dir = makeTempDir();
    writeFile(dir, 'script.json', serializeScript(sampleScript()));
    // Ontologia atribui "pessoa" como PROPRIEDADE, mas o script define OBJETO.
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
        indication: { form: 'acronym', sink: 'email' },
      }),
    );
    const captured: Indication[] = [];
    const result = runCommandLine(['debug', '--config', configPath], {
      sinks: [{ channel: 'email', deliver: (i) => captured.push(i) }],
    });
    expect(result.exitCode).toBe(1);
    expect(result.verdict?.valid).toBe(false);
    expect(captured[0]?.form).toBe('acronym');
    expect(captured[0]?.content).toContain('ERR:');
  });

  it('--form sobrescreve a forma do config', () => {
    const dir = makeTempDir();
    const configPath = setupScenario(dir);
    const result = runCommandLine(['debug', '--config', configPath, '--form', 'number']);
    expect(result.exitCode).toBe(0);
    expect(result.indications[0]?.form).toBe('number');
    expect(result.indications[0]?.content).toBe('0');
  });

  it('fonte de dados texto (não estruturada)', () => {
    const dir = makeTempDir();
    const script = sampleScript();
    // Ajusta mappings/condições para o campo "text" da fonte não estruturada.
    script.mappings = [{ entity: 'pessoa', dataField: 'text', parameter: 'personId' }];
    script.conditions = [{ dataSource: 'text', type: 'contains', expected: 'registro' }];
    writeFile(dir, 'script.json', serializeScript(script));
    writeFile(dir, 'ontologia.json', JSON.stringify(sampleOntology()));
    writeFile(dir, 'dados.txt', 'registro um\nregistro dois\n');
    const configPath = writeFile(
      dir,
      'debug.config.json',
      JSON.stringify({
        scriptFile: './script.json',
        ontologyFile: './ontologia.json',
        dataFile: './dados.txt',
        dataFormat: 'text',
      }),
    );
    const result = runCommandLine(['debug', '--config', configPath]);
    expect(result.exitCode).toBe(0);
    expect(result.verdict?.stats.items).toBe(2);
  });

  it('onIndication é usada com o canal do config quando sinks não são passados', () => {
    const dir = makeTempDir();
    const configPath = setupScenario(dir, { indication: { form: 'graphic', sink: 'popup' } });
    const captured: Indication[] = [];
    const result = runCommandLine(['debug', '--config', configPath], {
      onIndication: (i) => captured.push(i),
    });
    expect(result.exitCode).toBe(0);
    expect(captured[0]?.form).toBe('graphic');
    expect(captured[0]?.content).toBe('[OK]');
  });
});

describe('runCommandLine — erros e init-config', () => {
  it('sem --config retorna exitCode 2', () => {
    const result = runCommandLine(['debug']);
    expect(result.exitCode).toBe(2);
    expect(result.errors[0]).toContain('--config');
  });

  it('--mode inválido retorna exitCode 2', () => {
    const dir = makeTempDir();
    const configPath = setupScenario(dir);
    const result = runCommandLine(['debug', '--config', configPath, '--mode', 'turbo']);
    expect(result.exitCode).toBe(2);
  });

  it('config inexistente retorna exitCode 2 com mensagem', () => {
    const result = runCommandLine(['debug', '--config', '/nao/existe/config.json']);
    expect(result.exitCode).toBe(2);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('comando desconhecido retorna exitCode 2', () => {
    expect(runCommandLine(['explodir']).exitCode).toBe(2);
  });

  it('init-config gera config de exemplo identificando o ontology file', () => {
    const dir = makeTempDir();
    const target = join(dir, 'debug.config.json');
    const writes = new Map<string, string>();
    const result = runCommandLine(['init-config', target], {
      writeFile: (p, c) => {
        writes.set(p, c);
      },
    });
    expect(result.exitCode).toBe(0);
    const generated = JSON.parse(writes.get(target) ?? '{}') as Record<string, unknown>;
    expect(generated['ontologyFile']).toBe('./ontologia.json');
    expect(generated['scriptFile']).toBe('./script.json');
  });

  it('init-config usa debug.config.json por padrão', () => {
    const writes: string[] = [];
    const result = runCommandLine(['init-config'], {
      writeFile: (p) => {
        writes.push(p);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(writes[0]).toBe('debug.config.json');
  });
});
