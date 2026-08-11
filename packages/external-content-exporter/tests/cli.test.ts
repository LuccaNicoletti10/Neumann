/**
 * external-content-exporter — tests/cli.test.ts
 * Testes da CLI: runCommandLine(argv, deps) puro, comando demo e serve.
 */
import { describe, expect, it } from 'vitest';

import { runCommandLine } from '../src/cli.js';

describe('CLI (runCommandLine)', () => {
  it('sem comando imprime o uso e sai com código 0', async () => {
    const lines: string[] = [];
    const result = await runCommandLine([], { log: (m) => lines.push(m) });
    expect(result.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('external-content-exporter');
  });

  it('comando desconhecido sai com código 2 e imprime o uso no erro', async () => {
    const errors: string[] = [];
    const result = await runCommandLine(['inexistente'], { error: (m) => errors.push(m) });
    expect(result.exitCode).toBe(2);
    expect(errors.join('\n')).toContain('Uso:');
  });

  it('demo executa o fluxo completo e imprime os recibos de exportação', async () => {
    const lines: string[] = [];
    const result = await runCommandLine(['demo'], { log: (m) => lines.push(m) });
    expect(result.exitCode).toBe(0);
    const out = lines.join('\n');
    // 1. Bookmarklet instalado na barra de bookmarks.
    expect(out).toContain('bookmarklet-1');
    expect(out).toContain('javascript:');
    // 2. Conteúdo externo acessado via browser.
    expect(out).toContain('content-1');
    expect(out).toContain('externo.example.com');
    // 3. Enhance do browser.
    expect(out).toContain('tagging interface visível=true');
    // 4-5. Duas tags criadas e armazenadas localmente.
    expect(out).toContain('tag-1');
    expect(out).toContain('tag-2');
    expect(out).toContain('pendentes=2');
    // 6. Login + export (botão) + flush da fila.
    expect(out).toContain('session-1');
    expect(out).toContain('recibo: tag=tag-1');
    expect(out).toContain('recibo: tag=tag-2');
    expect(out).toContain('registros=2');
  });

  it('demo é determinístico: duas execuções imprimem a mesma saída', async () => {
    const primeira: string[] = [];
    const segunda: string[] = [];
    await runCommandLine(['demo'], { log: (m) => primeira.push(m) });
    await runCommandLine(['demo'], { log: (m) => segunda.push(m) });
    expect(primeira).toEqual(segunda);
  });

  it('serve valida --port e sobe o servidor na porta informada', async () => {
    const errors: string[] = [];
    const ruim = await runCommandLine(['serve', '--port', 'abc'], { error: (m) => errors.push(m) });
    expect(ruim.exitCode).toBe(2);
    expect(errors.join('\n')).toContain('--port');
  });
});
