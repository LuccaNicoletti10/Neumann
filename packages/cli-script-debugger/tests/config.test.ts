/**
 * cli-script-debugger — tests/config.test.ts
 * Testa o arquivo de configuração que identifica o ontology file e a
 * resolução de caminhos relativos ao config.
 */
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseConfigFile, resolveConfigPaths } from '../src/core/config.js';

describe('parseConfigFile', () => {
  it('faz parsing de config válido identificando o ontology file', () => {
    const config = parseConfigFile(
      JSON.stringify({
        scriptFile: './script.json',
        ontologyFile: './ontologia.json',
        dataFile: './dados.csv',
        dataFormat: 'csv',
      }),
    );
    expect(config.ontologyFile).toBe('./ontologia.json');
    expect(config.dataFormat).toBe('csv');
  });

  it('aplica dataFormat csv por padrão', () => {
    const config = parseConfigFile(
      JSON.stringify({ scriptFile: 's.json', ontologyFile: 'o.json', dataFile: 'd.txt' }),
    );
    expect(config.dataFormat).toBe('csv');
  });

  it('rejeita campos obrigatórios ausentes', () => {
    expect(() => parseConfigFile(JSON.stringify({ scriptFile: 's.json' }))).toThrow(
      /ontologyFile/,
    );
  });

  it('rejeita dataFormat desconhecido', () => {
    expect(() =>
      parseConfigFile(
        JSON.stringify({
          scriptFile: 's.json',
          ontologyFile: 'o.json',
          dataFile: 'd',
          dataFormat: 'xml',
        }),
      ),
    ).toThrow(/dataFormat/);
  });

  it('rejeita mode desconhecido', () => {
    expect(() =>
      parseConfigFile(
        JSON.stringify({
          scriptFile: 's.json',
          ontologyFile: 'o.json',
          dataFile: 'd',
          mode: 'turbo',
        }),
      ),
    ).toThrow(/mode/);
  });

  it('rejeita indication.form desconhecido', () => {
    expect(() =>
      parseConfigFile(
        JSON.stringify({
          scriptFile: 's.json',
          ontologyFile: 'o.json',
          dataFile: 'd',
          indication: { form: 'smoke-signal' },
        }),
      ),
    ).toThrow(/indication\.form/);
  });
});

describe('resolveConfigPaths', () => {
  it('resolve ontologyFile relativo ao diretório do config', () => {
    const config = parseConfigFile(
      JSON.stringify({
        scriptFile: './script.json',
        ontologyFile: './ontologia.json',
        dataFile: './dados.csv',
      }),
    );
    const resolved = resolveConfigPaths(config, '/tmp/projeto/configs');
    expect(resolved.ontologyFile).toBe('/tmp/projeto/configs/ontologia.json');
    expect(resolved.scriptFile).toBe('/tmp/projeto/configs/script.json');
    expect(resolved.dataFile).toBe('/tmp/projeto/configs/dados.csv');
  });

  it('mantém caminhos absolutos inalterados', () => {
    const config = parseConfigFile(
      JSON.stringify({
        scriptFile: '/abs/script.json',
        ontologyFile: '/abs/ontologia.json',
        dataFile: '/abs/dados.csv',
      }),
    );
    const resolved = resolveConfigPaths(config, '/outro/dir');
    expect(resolved.ontologyFile).toBe('/abs/ontologia.json');
  });

  it('resolve caminho relativo produzindo caminho absoluto', () => {
    const config = parseConfigFile(
      JSON.stringify({ scriptFile: 's.json', ontologyFile: 'o.json', dataFile: 'd.csv' }),
    );
    const resolved = resolveConfigPaths(config, 'configs/sub');
    expect(isAbsolute(resolved.ontologyFile)).toBe(true);
    expect(resolved.ontologyFile.endsWith('o.json')).toBe(true);
  });

  it('aplica defaults de modo e indicação', () => {
    const config = parseConfigFile(
      JSON.stringify({ scriptFile: 's.json', ontologyFile: 'o.json', dataFile: 'd.csv' }),
    );
    const resolved = resolveConfigPaths(config, '/tmp/x');
    expect(resolved.mode).toBe('eager');
    expect(resolved.indication).toEqual({ form: 'message', sink: 'debugger' });
  });
});
