/**
 * tagging-interface-panel — tests/cli.test.ts
 * Testes do runCommandLine (demo determinístico, usage, erros).
 */
import { describe, expect, it } from 'vitest';

import { runCommandLine } from '../src/cli.js';

function capture(): { lines: string[]; log: (m: string) => void; error: (m: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    log: (m: string) => lines.push(m),
    error: (m: string) => lines.push(`ERR ${m}`),
  };
}

describe('runCommandLine', () => {
  it('sem argumentos imprime o usage e retorna 0', async () => {
    const c = capture();
    const code = await runCommandLine([], c);
    expect(code).toBe(0);
    expect(c.lines.join('\n')).toContain('Uso:');
  });

  it('comando desconhecido retorna 2 e imprime usage no error', async () => {
    const c = capture();
    const code = await runCommandLine(['warp'], c);
    expect(code).toBe(2);
    expect(c.lines.some((l) => l.startsWith('ERR'))).toBe(true);
  });

  it('demo executa o fluxo completo (seleção → tags → sync → export) e retorna 0', async () => {
    const c = capture();
    const code = await runCommandLine(['demo'], c);
    expect(code).toBe(0);
    const out = c.lines.join('\n');
    expect(out).toContain('TITLE = Curiosity');
    expect(out).toContain('TYPE = Ground Travel');
    expect(out).toContain('tag criada: tag-1 "Curiosity" : Ground Travel');
    expect(out).toContain('property tag tag-3 "Smith, Jane" vinculada a tag-1');
    expect(out).toContain('link tag tag-4 entre tag-1 e tag-2');
    expect(out).toContain('TYPE agora é "Air Travel"');
    expect(out).toContain('sync: tag-1 ⇢ obj-curiosity');
    expect(out).toContain('TagOption: Object');
    expect(out).toContain('Title: Curiosity');
    expect(out).toContain('Content: content-1');
    expect(out).toContain('DateAdded: 2014-09-18T12:00:00.000Z');
    expect(out).toContain('User: analista');
    expect(out).toContain('TAGGING INTERFACE (450)');
  });

  it('demo é determinístico (duas execuções, mesma saída)', async () => {
    const a = capture();
    const b = capture();
    await runCommandLine(['demo'], a);
    await runCommandLine(['demo'], b);
    expect(a.lines).toEqual(b.lines);
  });

  it('--port inválido retorna 2', async () => {
    const c = capture();
    const code = await runCommandLine(['serve', '--port', 'abc'], c);
    expect(code).toBe(2);
    expect(c.lines.join('\n')).toContain('--port');
  });
});
