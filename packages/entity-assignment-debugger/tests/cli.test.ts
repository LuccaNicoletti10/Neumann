/**
 * Testes da CLI: demo (atribuído como objeto × definido como propriedade →
 * expressed invalid; corrigida → validated), debug com arquivos, check-ontology
 * e tratamento de uso.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

function capture(): { lines: string[]; out: (l: string) => void } {
  const lines: string[] = [];
  return { lines, out: (l) => lines.push(l) };
}

const scriptJson = JSON.stringify({
  name: 'cli',
  definitions: [
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
  ],
  links: [],
  mappings: [{ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' }],
  conditions: [{ id: 'c1', entity: 'Endereco', dataItemId: 'row-1' }],
});

const ontologyOk = JSON.stringify({
  assignments: [
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
  ],
});

const ontologyBad = JSON.stringify({
  assignments: [
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'object', name: 'Endereco', properties: {} },
  ],
});

function writeTemp(files: Record<string, string>): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'ead-'));
  const paths: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, content, 'utf8');
    paths[name] = p;
  }
  return paths;
}

describe('CLI', () => {
  it('demo: primeiro EXPRESSED invalid, depois "transformation script has been validated"', async () => {
    const { lines, out } = capture();
    const code = await run(['demo'], out);
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('is invalid'); // caso 1: atribuído objeto × definido propriedade
    expect(text).toContain('transformation script has been validated'); // caso 2: corrigida
    expect(text).toContain('FALHA (como esperado)');
    expect(text).toContain('SUCESSO');
  });

  it('debug com ontologia consistente → exit 0 e mensagem validated', async () => {
    const p = writeTemp({ 's.json': scriptJson, 'o.json': ontologyOk, 'd.csv': 'nome\nAda\n' });
    const { lines, out } = capture();
    const code = await run(
      ['debug', '--script', p['s.json']!, '--ontology', p['o.json']!, '--data', p['d.csv']!],
      out,
    );
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('transformation script has been validated');
    expect(lines.join('\n')).toContain('SUCESSO');
  });

  it('debug com ontologia inconsistente → exit 1 e invalid expressed', async () => {
    const p = writeTemp({ 's.json': scriptJson, 'o.json': ontologyBad, 'd.csv': 'nome\nAda\n' });
    const { lines, out } = capture();
    const code = await run(
      ['debug', '--script', p['s.json']!, '--ontology', p['o.json']!, '--data', p['d.csv']!],
      out,
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('is invalid');
    expect(lines.join('\n')).toContain('FALHA');
  });

  it('debug com fonte de texto livre via --format text --pattern', async () => {
    const scriptTexto = JSON.stringify({
      name: 't',
      definitions: [{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }],
      links: [],
      mappings: [{ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'match-1' }],
      conditions: [{ id: 'c1', entity: 'Pessoa', dataItemId: 'match-1' }],
    });
    const p = writeTemp({
      's.json': scriptTexto,
      'o.json': JSON.stringify({ assignments: [{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }] }),
      'd.txt': 'Ada Lovelace tem 36 anos\n',
    });
    const { out } = capture();
    const code = await run(
      [
        'debug', '--script', p['s.json']!, '--ontology', p['o.json']!, '--data', p['d.txt']!,
        '--format', 'text', '--pattern', '^(?<nome>[A-Za-z ]+) tem (?<idade>\\d+) anos$',
      ],
      out,
    );
    expect(code).toBe(0);
  });

  it('check-ontology: consistente → exit 0; inconsistente → exit 1 com razões', async () => {
    const p = writeTemp({ 's.json': scriptJson, 'ok.json': ontologyOk, 'bad.json': ontologyBad });

    const ok = capture();
    expect(await run(['check-ontology', '--script', p['s.json']!, '--ontology', p['ok.json']!], ok.out)).toBe(0);
    expect(ok.lines.join('\n')).toContain('ontologia consistente');

    const bad = capture();
    expect(await run(['check-ontology', '--script', p['s.json']!, '--ontology', p['bad.json']!], bad.out)).toBe(1);
    expect(bad.lines.join('\n')).toContain('ERRO entidade "Endereco"');
  });

  it('sem comando → imprime uso e exit 0; comando desconhecido → exit 2', async () => {
    const help = capture();
    expect(await run([], help.out)).toBe(0);
    expect(help.lines.join('\n')).toContain('Uso:');

    const unknown = capture();
    expect(await run(['xyz'], unknown.out)).toBe(2);
    expect(unknown.lines.join('\n')).toContain('comando desconhecido');
  });
});
