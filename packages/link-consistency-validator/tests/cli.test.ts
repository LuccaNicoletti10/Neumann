/**
 * link-consistency-validator — testes da CLI sobre os mecanismos da patente
 * US 8,930,897 B2 (validate, parse, demo) com canais injetáveis.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, type CliIO } from '../src/cli.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lcv-cli-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (m) => out.push(m),
      stderr: (m) => err.push(m),
      readFile: async (p) => {
        const { readFile } = await import('node:fs/promises');
        return readFile(p, 'utf8');
      },
    },
  };
}

const SCRIPT_OK = [
  'object Pessoa',
  'object Empresa',
  'link Pessoa --trabalha_em--> Empresa',
  'condition c1 Pessoa --trabalha_em--> Empresa uses csv-1',
].join('\n');

const ONTOLOGY_OK = JSON.stringify({
  links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
});
const ONTOLOGY_INVERTED = JSON.stringify({
  links: [{ from: 'Empresa', predicate: 'trabalha_em', to: 'Pessoa' }],
});
const CSV = 'nome\nAna\n';

async function fixture(script: string, ontology: string): Promise<{ s: string; o: string; d: string }> {
  const s = join(dir, `script-${script.length}.dsl`);
  const o = join(dir, `ont-${ontology.length}.json`);
  const d = join(dir, 'data.csv');
  await writeFile(s, script);
  await writeFile(o, ontology);
  await writeFile(d, CSV);
  return { s, o, d };
}

describe('CLI validate', () => {
  it('valida script consistente (exit 0) e exibe "transformation script has been validated"', async () => {
    const { s, o, d } = await fixture(SCRIPT_OK, ONTOLOGY_OK);
    const { io, out } = makeIO();
    const code = await runCli(['validate', '--script', s, '--ontology', o, '--data', d], io);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('transformation script has been validated');
    expect(out.join('\n')).toContain('[EXPRESSED]');
  });

  it('retorna exit 1 e resultado EXPRESSED inválido quando o link da ontologia está invertido', async () => {
    const { s, o, d } = await fixture(SCRIPT_OK, ONTOLOGY_INVERTED);
    const { io, out } = makeIO();
    const code = await runCli(['validate', '--script', s, '--ontology', o, '--data', d], io);
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('não é válida');
    expect(out.join('\n')).toContain('DISPLAY:');
  });

  it('--format json emite a sequência de resultados em JSON', async () => {
    const { s, o, d } = await fixture(SCRIPT_OK, ONTOLOGY_OK);
    const { io, out } = makeIO();
    const code = await runCli(
      ['validate', '--script', s, '--ontology', o, '--data', d, '--format', 'json'],
      io,
    );
    expect(code).toBe(0);
    const jsonLine = out.find((l) => l.startsWith('['));
    expect(jsonLine).toBeDefined();
    const results = JSON.parse(jsonLine as string) as Array<{ kind: string; valid: boolean }>;
    expect(results[0]).toMatchObject({ kind: 'expressed', valid: true });
  });

  it('suporta fonte de texto não estruturado via --data-format text --pattern', async () => {
    const s = join(dir, 'script-text.dsl');
    const o = join(dir, 'ont-text.json');
    const d = join(dir, 'data.txt');
    await writeFile(s, SCRIPT_OK.replace('csv-1', 'text-1'));
    await writeFile(o, ONTOLOGY_OK);
    await writeFile(d, 'PESSOA Ana TRABALHA_EM ACME');
    const { io } = makeIO();
    const code = await runCli(
      ['validate', '--script', s, '--ontology', o, '--data', d, '--data-format', 'text',
        '--pattern', 'PESSOA (?<nome>\\w+) TRABALHA_EM (?<empresa>\\w+)'],
      io,
    );
    expect(code).toBe(0);
  });

  it('sem flags obrigatórias → exit 2', async () => {
    const { io, err } = makeIO();
    const code = await runCli(['validate'], io);
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('--script');
  });
});

describe('CLI parse', () => {
  it('imprime entidades, links e condições em JSON', async () => {
    const { s } = await fixture(SCRIPT_OK, ONTOLOGY_OK);
    const { io, out } = makeIO();
    const code = await runCli(['parse', s], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('')) as { entities: unknown[]; links: unknown[]; conditions: unknown[] };
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.links).toHaveLength(1);
    expect(parsed.conditions).toHaveLength(1);
  });

  it('DSL inválida → exit 1 com erro na saída de erro', async () => {
    const bad = join(dir, 'bad.dsl');
    await writeFile(bad, '$$$');
    const { io, err } = makeIO();
    const code = await runCli(['parse', bad], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('linha 1');
  });
});

describe('CLI demo', () => {
  it('mostra o fluxo implicit + expressed inválido com link inconsistente embutido', async () => {
    const { io, out } = makeIO();
    const code = await runCli(['demo'], io);
    expect(code).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('[IMPLICIT]'); // c1 válida com condição subsequente
    expect(text).toContain('[EXPRESSED]'); // c2 inválida
    expect(text).toContain('não é válida');
    expect(text).toMatch(/direção invertida|predicado divergente/);
  });
});

describe('CLI ajuda e erros', () => {
  it('--help → exit 0 com uso', async () => {
    const { io, out } = makeIO();
    expect(await runCli(['--help'], io)).toBe(0);
    expect(out.join('\n')).toContain('uso:');
  });

  it('comando desconhecido → exit 2', async () => {
    const { io, err } = makeIO();
    expect(await runCli(['nada'], io)).toBe(2);
    expect(err.join('\n')).toContain('comando desconhecido');
  });
});
