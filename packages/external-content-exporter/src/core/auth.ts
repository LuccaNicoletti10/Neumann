/**
 * external-content-exporter — src/core/auth.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: LOGIN E SESSÕES — a
 * exportação para o internal database system EXIGE login; a autenticação é
 * injetável, com sessões de token determinístico (contador) e createdAt vindo
 * do clock injetável; requireSession bloqueia exportações sem sessão.
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { CoreError } from './types.js';
import type { Clock, IdGenerator, Session } from './types.js';

/** Código de erro emitido quando a exportação é tentada sem login. */
export const LOGIN_REQUIRED = 'LOGIN_REQUIRED';

/** Verificador de credenciais injetável (user + password → válido?). */
export type CredentialVerifier = (user: string, password: string) => boolean;

/** Usuários default do ambiente de demonstração. */
export const DEFAULT_USERS: Readonly<Record<string, string>> = {
  analyst: 'senha-demo',
};

/** Serviço de autenticação com sessões determinísticas. */
export interface AuthService {
  /** Autentica o usuário e abre uma sessão (token "session-N"). */
  login(user: string, password: string): Session;
  /** Encerra a sessão; devolve false se o token não existia. */
  logout(token: string): boolean;
  /** Devolve a sessão do token ou lança CoreError(LOGIN_REQUIRED). */
  requireSession(token: string | undefined): Session;
  /** Há alguma sessão aberta? (device "conectado" ao banco interno.) */
  hasActiveSession(): boolean;
  /** Sessão ativa mais recente (para auto-export), se houver. */
  currentSession(): Session | undefined;
}

export interface AuthDeps {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Verificador injetável; default usa DEFAULT_USERS. */
  verifyCredentials?: CredentialVerifier;
}

/** Cria o serviço de autenticação (sessões com token por contador). */
export function createAuth(deps: AuthDeps = {}): AuthService {
  const clock = deps.clock ?? createDeterministicClock();
  const nextId = deps.nextId ?? createIdGenerator();
  const verify =
    deps.verifyCredentials ??
    ((user: string, password: string): boolean => DEFAULT_USERS[user] === password);
  const sessions = new Map<string, Session>();
  let lastToken: string | undefined;

  return {
    login(user: string, password: string): Session {
      if (user.trim() === '') {
        throw new CoreError('INVALID_CREDENTIALS', 'usuário não pode ser vazio');
      }
      if (!verify(user, password)) {
        throw new CoreError('INVALID_CREDENTIALS', `credenciais inválidas para "${user}"`);
      }
      const session: Session = { token: nextId('session'), user, createdAt: clock() };
      sessions.set(session.token, session);
      lastToken = session.token;
      return { ...session };
    },
    logout(token: string): boolean {
      const removed = sessions.delete(token);
      if (removed && lastToken === token) {
        lastToken = [...sessions.keys()].at(-1);
      }
      return removed;
    },
    requireSession(token: string | undefined): Session {
      const session = token === undefined ? undefined : sessions.get(token);
      if (session === undefined) {
        throw new CoreError(
          LOGIN_REQUIRED,
          'a exportação para o internal database system exige login',
        );
      }
      return { ...session };
    },
    hasActiveSession(): boolean {
      return sessions.size > 0;
    },
    currentSession(): Session | undefined {
      const session = lastToken === undefined ? undefined : sessions.get(lastToken);
      return session === undefined ? undefined : { ...session };
    },
  };
}
