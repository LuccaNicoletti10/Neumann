/**
 * inline-tag-sync — tests/cli.test.ts
 * Testes da CLI (runCommandLine puro, demo do fluxo completo, uso/erros).
 */
import { describe, expect, it } from 'vitest';

import { runCommandLine } from '../src/cli.js';

function capture(): { lines: string[]; log: (m: string) => void; err: (m: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    log: (m: string) => lines.push(m),
    err: (m: string) => lines.push(`ERR:${m}`),
  };
}

describe('CLI inline-tag-sync', () => {
  it('sem comando exibe o uso e retorna 0', async () => {
    const { lines, log, err } = capture();
    const code = await runCommandLine([], { log, error: err });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('inline-tag-sync demo');
  });

  it('comando desconhecido retorna 2 e exibe o uso no erro', async () => {
    const { lines, log, err } = capture();
    const code = await runCommandLine(['xyz'], { log, error: err });
    expect(code).toBe(2);
    expect(lines.some((l) => l.startsWith('ERR:'))).toBe(true);
  });

  it('demo executa o fluxo completo e retorna 0', async () => {
    const { lines, log, err } = capture();
    const code = await runCommandLine(['demo'], { log, error: err });
    expect(code).toBe(0);
    const out = lines.join('\n');
    // 1. documento; 2. first tag; 3. atalho "@"; 4. data object;
    // 5. second tag; 6. re-edição sem deslocamento; 7. colaboração.
    expect(out).toContain('Documento criado');
    expect(out).toContain("resultado: John Doe's Profile [Person]");
    expect(out).toContain('first tag tag-1 aplicada');
    expect(out).toContain('"@John Doe" substituído por "Email: johndoe@email.com"');
    expect(out).toContain('[TAG:Person/Name]John Doe[/TAG]');
    expect(out).toContain('data object "dobj-1" [Document] carrega 2 tag(s)');
    expect(out).toContain('second tag tag-3 (object-based, por bruno)');
    expect(out).toContain('**__Local News__**');
    expect(out).toContain('Propriedade tagueada: Title = Local News');
    expect(out).toContain('tags do documento da sessão: 0 (removidas)');
    expect(out).toContain('tags re-aplicadas nas localizações absolutas: 3');
    expect(out).toContain('sincronizados: true');
    expect(out).toContain('aprovado para publicação');
  });

  it('demo registra histórico de revisões com userId', async () => {
    const { lines, log, err } = capture();
    await runCommandLine(['demo'], { log, error: err });
    const out = lines.join('\n');
    expect(out).toContain('[create] ana');
    expect(out).toContain('[sync]');
    expect(out).toContain('[comment] bruno');
  });

  it('serve com --port inválido retorna 2', async () => {
    const { lines, log, err } = capture();
    const code = await runCommandLine(['serve', '--port', 'abc'], { log, error: err });
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('--port');
  });
});
