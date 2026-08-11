/**
 * external-content-exporter — tests/auth.test.ts
 * Testes do mecanismo 6 (EXPORTAÇÃO EXIGE LOGIN; sessões injetáveis).
 */
import { describe, expect, it } from 'vitest';

import { createAuth, LOGIN_REQUIRED } from '../src/core/auth.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { CoreError } from '../src/core/types.js';

describe('auth (login/sessões)', () => {
  it('login cria sessão com token determinístico e createdAt do clock', () => {
    const auth = createAuth({ clock: createDeterministicClock(), nextId: createIdGenerator() });
    const session = auth.login('analyst', 'senha-demo');
    expect(session.token).toBe('session-1');
    expect(session.user).toBe('analyst');
    expect(session.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('tokens são contadores crescentes (session-1, session-2)', () => {
    const auth = createAuth({ nextId: createIdGenerator() });
    expect(auth.login('analyst', 'senha-demo').token).toBe('session-1');
    expect(auth.login('analyst', 'senha-demo').token).toBe('session-2');
  });

  it('rejeita credenciais inválidas e usuário vazio', () => {
    const auth = createAuth();
    expect(() => auth.login('analyst', 'errada')).toThrow(/credenciais inválidas/);
    expect(() => auth.login(' ', 'senha-demo')).toThrow(/usuário não pode ser vazio/);
  });

  it('aceita verificador de credenciais injetável', () => {
    const auth = createAuth({ verifyCredentials: (user, password) => user === password });
    expect(auth.login('bob', 'bob').user).toBe('bob');
    expect(() => auth.login('bob', 'alice')).toThrow(/credenciais inválidas/);
  });

  it('requireSession bloqueia sem token ou com token desconhecido (LOGIN_REQUIRED)', () => {
    const auth = createAuth();
    for (const token of [undefined, 'session-99']) {
      try {
        auth.requireSession(token);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CoreError);
        expect((error as CoreError).code).toBe(LOGIN_REQUIRED);
      }
    }
  });

  it('logout encerra a sessão e requireSession passa a falhar', () => {
    const auth = createAuth();
    const session = auth.login('analyst', 'senha-demo');
    expect(auth.hasActiveSession()).toBe(true);
    expect(auth.logout(session.token)).toBe(true);
    expect(auth.hasActiveSession()).toBe(false);
    expect(auth.logout(session.token)).toBe(false);
    expect(() => auth.requireSession(session.token)).toThrow(/LOGIN_REQUIRED|exige login/);
  });

  it('currentSession devolve a sessão ativa mais recente', () => {
    const auth = createAuth({ nextId: createIdGenerator() });
    expect(auth.currentSession()).toBeUndefined();
    auth.login('analyst', 'senha-demo');
    const segunda = auth.login('analyst', 'senha-demo');
    expect(auth.currentSession()?.token).toBe(segunda.token);
    auth.logout(segunda.token);
    expect(auth.currentSession()?.token).toBe('session-1');
  });
});
