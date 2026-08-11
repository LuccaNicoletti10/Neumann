/**
 * schema-registry — tests/cli.test.ts
 */
import { describe, expect, it } from 'vitest';

import { runCommandLine } from '../src/cli.js';

function capture() {
  const lines: string[] = [];
  return {
    lines,
    log: (m: string) => lines.push(m),
    error: (m: string) => lines.push(`ERR:${m}`),
  };
}

describe('CLI schema-registry', () => {
  it('sem comando imprime uso', async () => {
    const c = capture();
    expect(await runCommandLine([], c)).toBe(0);
    expect(c.lines.join('\n')).toContain('schema-registry demo');
  });

  it('comando desconhecido → 2', async () => {
    const c = capture();
    expect(await runCommandLine(['xyz'], c)).toBe(2);
  });

  it('demo executa T1.4 (compatible/coercible/breaking) e discover', async () => {
    const c = capture();
    expect(await runCommandLine(['demo'], c)).toBe(0);
    const out = c.lines.join('\n');
    expect(out).toContain('Discover');
    expect(out).toContain('hint=email');
    expect(out).toContain('drift=compatible');
    expect(out).toContain('drift=coercible');
    expect(out).toContain('drift=breaking');
    expect(out).toContain('pausado: true');
  });

  it('demo é determinístico', async () => {
    const a = capture();
    const b = capture();
    await runCommandLine(['demo'], a);
    await runCommandLine(['demo'], b);
    expect(a.lines).toEqual(b.lines);
  });

  it('serve --port inválido → 2', async () => {
    const c = capture();
    expect(await runCommandLine(['serve', '--port', 'abc'], c)).toBe(2);
  });
});
