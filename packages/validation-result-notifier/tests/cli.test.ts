import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDemoScript, mergeScriptAndOntology, runCli, type CliIO } from '../src/cli.js';

function captureIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      log: (message) => out.push(message),
      error: (message) => err.push(message),
    },
  };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vrn-cli-'));
  const script = {
    name: 'cli-script',
    entities: [
      { entity: 'Cliente', kind: 'object' },
      { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
    ],
    conditions: [
      {
        id: 'c1',
        description: 'válida intermediária',
        assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
        mappings: [{ dataItemId: 'a1', parameterName: 'p-nome' }],
      },
      {
        id: 'c2',
        description: 'inválida',
        assignment: { entity: 'nome', kind: 'object' },
        mappings: [],
      },
      {
        id: 'c3',
        description: 'válida final',
        assignment: { entity: 'Cliente', kind: 'object' },
        mappings: [],
      },
    ],
  };
  const ontology = {
    parameters: [
      { name: 'p-nome', defines: { entity: 'nome', kind: 'property', parentObject: 'Cliente' } },
    ],
  };
  const data = { format: 'csv', content: 'id,nome\na1,Ada' };
  await writeFile(join(dir, 'script.json'), JSON.stringify(script));
  await writeFile(join(dir, 'ontology.json'), JSON.stringify(ontology));
  await writeFile(join(dir, 'data.json'), JSON.stringify(data));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CLI — validate', () => {
  it('valida script+ontologia+data e entrega expressed (implicit não entregue)', async () => {
    const { io, out } = captureIO();
    const code = await runCli(
      [
        'validate',
        '--script',
        join(dir, 'script.json'),
        '--ontology',
        join(dir, 'ontology.json'),
        '--data',
        join(dir, 'data.json'),
        '--channel',
        'debugger',
        '--form',
        'acronym',
      ],
      io,
    );
    expect(code).toBe(0);
    const text = out.join('\n');
    // c1 válida intermediária → implicit (não entregue)
    expect(text).toContain("[implicit] condição 'c1' válida=true");
    // c2 inválida + c3 válida final → 2 expressed entregues
    expect(text).toContain('2 indicação(ões) expressed entregue(s)');
    expect(text).toContain('EINV-ENT-001');
    expect(text).toContain('SVAL-OK-000');
  });

  it('falha sem flags obrigatórias', async () => {
    const { io, err } = captureIO();
    const code = await runCli(['validate', '--script', join(dir, 'script.json')], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('--data');
  });

  it('rejeita canal inválido', async () => {
    const { io, err } = captureIO();
    const code = await runCli(
      ['validate', '--script', join(dir, 'script.json'), '--data', join(dir, 'data.json'), '--channel', 'fax'],
      io,
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('canal inválido');
  });

  it('mergeScriptAndOntology une parâmetros do script e do arquivo de ontologia', () => {
    const merged = mergeScriptAndOntology(
      { name: 'x', entities: [], ontologyParameters: [{ name: 'p1', defines: { entity: 'A', kind: 'object' } }], conditions: [] },
      { parameters: [{ name: 'p2', defines: { entity: 'B', kind: 'object' } }] },
    );
    expect(merged.ontologyParameters.map((p) => p.name)).toEqual(['p1', 'p2']);
  });
});

describe('CLI — demo', () => {
  it('entrega 2 condições inválidas nos 3 canais × 4 formas (24 indicações)', async () => {
    const { io, out } = captureIO();
    const code = await runCli(['demo'], io);
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('canal=debugger forma=message: 2');
    expect(text).toContain('canal=email forma=graphic: 2');
    expect(text).toContain('canal=popup forma=number: 2');
    expect(text).toContain('total de indicações de condições inválidas entregues: 24');
  });

  it('buildDemoScript tem 2 condições inválidas e 1 válida final', () => {
    const { script } = buildDemoScript();
    expect(script.conditions.map((c) => c.id)).toEqual(['c-erro-entidade', 'c-erro-mapping', 'c-ok']);
  });
});

describe('CLI — demais comandos', () => {
  it('help retorna 0 e mostra uso', async () => {
    const { io, out } = captureIO();
    expect(await runCli(['help'], io)).toBe(0);
    expect(out.join('\n')).toContain('validate --script');
  });

  it('sem comando retorna 1 com uso', async () => {
    const { io, out } = captureIO();
    expect(await runCli([], io)).toBe(1);
    expect(out.join('\n')).toContain('comandos:');
  });

  it('comando desconhecido retorna 2', async () => {
    const { io, err } = captureIO();
    expect(await runCli(['explodir'], io)).toBe(2);
    expect(err.join('\n')).toContain('comando desconhecido');
  });
});
