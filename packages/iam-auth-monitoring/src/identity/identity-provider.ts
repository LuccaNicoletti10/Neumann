/**
 * IdentityProvider — interface interna de identidade estilo better-auth.
 *
 * Componente do passo: a plataforma fala SOMENTE com esta interface; um
 * better-auth real poderia ser plugado depois implementando a mesma interface.
 * Cobre registro de usuarios (senha com scrypt), contas de servico (API key —
 * guarda apenas o hash), autenticacao (email+password OU apiKey), sessoes com
 * token opaco e expiracao configuravel, e desabilitacao de principals.
 *
 * Tambem e o ponto de instrumentacao do monitoramento (US 8,763,078): cada
 * tentativa de autenticacao, sucesso ou falha, dispara os listeners de
 * `onAttempt` registrados pelo LoginMonitoringModule.
 */

import { createHash, randomBytes } from 'node:crypto';
import { buildAuthRecord, type AuthAttemptContext, type AuthenticationRecord } from '../auth-monitoring/auth-record.js';
import { hashPassword, verifyPassword } from './password.js';
import type { Principal, PrincipalStore } from './principal-store.js';

export interface Session {
  token: string;
  principalId: string;
  createdAt: string;
  expiresAt: string;
}

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
  groups?: string[] | undefined;
  roles?: string[] | undefined;
  notificationHandles?: { email?: string | undefined; sms?: string | undefined } | undefined;
}

export interface CreateServiceAccountInput {
  name: string;
  roles?: string[] | undefined;
  groups?: string[] | undefined;
  notificationHandles?: { email?: string | undefined; sms?: string | undefined } | undefined;
}

export type AuthenticateInput =
  | { kind: 'password'; email: string; password: string }
  | { kind: 'apiKey'; apiKey: string };

export interface AuthenticateSuccess {
  ok: true;
  session: Session;
  principal: Principal;
  attempt: AuthenticationRecord;
}

export interface AuthenticateFailure {
  ok: false;
  reason: 'invalid_credentials' | 'principal_disabled';
  attempt: AuthenticationRecord;
}

export type AuthenticateResult = AuthenticateSuccess | AuthenticateFailure;

export type AttemptListener = (attempt: AuthenticationRecord, principal: Principal | undefined) => void;

export interface IdentityProviderOptions {
  /** TTL da sessao em ms (default: 1 hora). */
  sessionTtlMs?: number;
  /** Relogio injetavel para testes. */
  now?: () => Date;
}

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export class IdentityProvider {
  private readonly store: PrincipalStore;
  private readonly sessionTtlMs: number;
  private readonly now: () => Date;
  private readonly sessions = new Map<string, Session>();
  private readonly attemptListeners: AttemptListener[] = [];

  constructor(store: PrincipalStore, options: IdentityProviderOptions = {}) {
    this.store = store;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = options.now ?? (() => new Date());
  }

  onAttempt(listener: AttemptListener): void {
    this.attemptListeners.push(listener);
  }

  registerUser(input: RegisterUserInput): Principal {
    if (input.password.length < 8) {
      throw new Error('senha deve ter pelo menos 8 caracteres');
    }
    return this.store.create({
      kind: 'user',
      name: input.name,
      email: input.email,
      groups: input.groups ?? [],
      roles: input.roles ?? [],
      disabled: false,
      passwordHash: hashPassword(input.password),
      notificationHandles: { email: input.email, ...input.notificationHandles },
    });
  }

  /** Retorna a API key em claro UMA unica vez; apenas o hash fica persistido. */
  createServiceAccount(input: CreateServiceAccountInput): { principal: Principal; apiKey: string } {
    const apiKey = `pk_${randomBytes(24).toString('hex')}`;
    const principal = this.store.create({
      kind: 'service',
      name: input.name,
      groups: input.groups ?? [],
      roles: input.roles ?? [],
      disabled: false,
      apiKeyHash: hashApiKey(apiKey),
      notificationHandles: input.notificationHandles ?? {},
    });
    return { principal, apiKey };
  }

  authenticate(input: AuthenticateInput, context: AuthAttemptContext): AuthenticateResult {
    const credentialId = input.kind === 'password' ? input.email : this.serviceAccountNameFor(input.apiKey);
    let principal: Principal | undefined;
    let ok = false;

    if (input.kind === 'password') {
      principal = this.store.getByEmail(input.email);
      ok = principal !== undefined && principal.passwordHash !== undefined
        && verifyPassword(input.password, principal.passwordHash);
    } else {
      principal = this.store.getByApiKeyHash(hashApiKey(input.apiKey));
      ok = principal !== undefined;
    }

    if (principal !== undefined && principal.disabled) {
      const attempt = this.emitAttempt(credentialId, false, context, principal);
      return { ok: false, reason: 'principal_disabled', attempt };
    }

    if (!ok || principal === undefined) {
      const attempt = this.emitAttempt(credentialId, false, context, principal);
      return { ok: false, reason: 'invalid_credentials', attempt };
    }

    const session = this.createSession(principal.id);
    const attempt = this.emitAttempt(credentialId, true, context, principal);
    return { ok: true, session, principal, attempt };
  }

  /** Resolve um token de sessao (Bearer) ou uma API key em principal. Retorna null se invalido/expirado/desabilitado. */
  resolveToken(token: string): Principal | null {
    const apiKeyPrincipal = this.store.getByApiKeyHash(hashApiKey(token));
    if (apiKeyPrincipal !== undefined) {
      return apiKeyPrincipal.disabled ? null : apiKeyPrincipal;
    }
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    if (this.now().getTime() >= Date.parse(session.expiresAt)) {
      this.sessions.delete(token);
      return null;
    }
    const principal = this.store.getById(session.principalId);
    if (principal === undefined || principal.disabled) return null;
    return principal;
  }

  disablePrincipal(id: string): Principal | undefined {
    const updated = this.store.update(id, { disabled: true });
    for (const [token, session] of this.sessions) {
      if (session.principalId === id) this.sessions.delete(token);
    }
    return updated;
  }

  private createSession(principalId: string): Session {
    const created = this.now();
    const session: Session = {
      token: `st_${randomBytes(32).toString('hex')}`,
      principalId,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + this.sessionTtlMs).toISOString(),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  private serviceAccountNameFor(apiKey: string): string {
    return this.store.getByApiKeyHash(hashApiKey(apiKey))?.name ?? 'apikey:desconhecida';
  }

  private emitAttempt(
    credentialId: string,
    success: boolean,
    context: AuthAttemptContext,
    principal: Principal | undefined,
  ): AuthenticationRecord {
    const attempt = buildAuthRecord({
      userId: credentialId,
      success,
      ip: context.ip,
      ...(context.location !== undefined ? { location: context.location } : {}),
      ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      timestamp: this.now().toISOString(),
    });
    for (const listener of this.attemptListeners) listener(attempt, principal);
    return attempt;
  }
}
