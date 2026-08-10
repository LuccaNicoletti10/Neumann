/**
 * login-monitor.ts — LoginMonitoringModule.
 *
 * Componente da patente US 8,763,078 (implementacao funcional independente):
 * monitora o fluxo de autenticacao (hook no IdentityProvider via onAttempt),
 * registra cada tentativa (sucesso ou falha) e repassa cada nova tentativa ao
 * RuleBasedNotificationModule (NotificationRuleBook + NotificationEngine),
 * que decide se notifica e quem. Tambem alimenta as metricas e mantem o log
 * das tentativas (opcionalmente em JSONL em disco, para o CLI `metrics`).
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IdentityProvider } from '../identity/identity-provider.js';
import type { Principal, PrincipalStore } from '../identity/principal-store.js';
import type { AuthenticationRecord } from './auth-record.js';
import { AuthMetrics } from './metrics.js';
import { NotificationEngine } from './notification-engine.js';
import type { Notifier } from './notifiers.js';
import {
  NotificationRuleBook,
  defaultRules,
  type CombinationMode,
  type NotificationRule,
} from './rules.js';

export interface LoginMonitorOptions {
  mode?: CombinationMode;
  /** Caminho JSONL para persistir tentativas (usado pelo CLI `metrics`). */
  attemptsLogPath?: string;
  now?: () => Date;
}

export class LoginMonitoringModule {
  readonly ruleBook: NotificationRuleBook;
  readonly engine: NotificationEngine;
  readonly metrics = new AuthMetrics();
  private readonly mode: CombinationMode;
  private readonly now: () => Date;
  private readonly attemptsLogPath?: string;
  private readonly attempts: AuthenticationRecord[] = [];
  /** Ultima tentativa bem-sucedida por credencial (base das regras location/latency). */
  private readonly lastSuccessByUser = new Map<string, AuthenticationRecord>();

  constructor(
    ruleBook: NotificationRuleBook,
    engine: NotificationEngine,
    options: LoginMonitorOptions = {},
  ) {
    this.ruleBook = ruleBook;
    this.engine = engine;
    this.mode = options.mode ?? 'ANY';
    this.now = options.now ?? (() => new Date());
    if (options.attemptsLogPath !== undefined) this.attemptsLogPath = options.attemptsLogPath;
  }

  /** Liga o monitor ao provedor de identidade. */
  attach(provider: IdentityProvider): void {
    provider.onAttempt((attempt, principal) => {
      void this.record(attempt, principal);
    });
  }

  /** Registra a tentativa e dispara a avaliacao de regras/notificacao. */
  async record(attempt: AuthenticationRecord, _principal?: Principal): Promise<void> {
    const previousAttempt = this.lastSuccessByUser.get(attempt.userId);
    this.attempts.push(attempt);
    this.appendToLog(attempt);
    this.metrics.recordAttempt(attempt);

    const decision = this.ruleBook.evaluate(
      {
        attempt,
        ...(previousAttempt !== undefined ? { previousAttempt } : {}),
        notifications: this.engine.listHistory(),
        now: this.now(),
      },
      this.mode,
    );

    if (decision.notify) {
      await this.engine.notify(attempt, decision);
      this.metrics.recordNotification(attempt.userId, attempt.ip);
    }

    if (attempt.success) this.lastSuccessByUser.set(attempt.userId, attempt);
  }

  listAttempts(): AuthenticationRecord[] {
    return [...this.attempts];
  }

  getAttempt(attemptId: string): AuthenticationRecord | undefined {
    return this.attempts.find((a) => a.attemptId === attemptId);
  }

  /** Marca a tentativa como suspeita (resposta "reportBreach" do usuario). */
  markBreach(attemptId: string): boolean {
    const attempt = this.getAttempt(attemptId);
    if (attempt === undefined) return false;
    attempt.flaggedAsBreach = true;
    this.metrics.recordBreach(attempt.userId, attempt.ip);
    return true;
  }

  private appendToLog(attempt: AuthenticationRecord): void {
    if (this.attemptsLogPath === undefined) return;
    mkdirSync(dirname(this.attemptsLogPath), { recursive: true });
    appendFileSync(this.attemptsLogPath, `${JSON.stringify(attempt)}\n`);
  }
}

export interface AuthMonitoringBundle {
  monitor: LoginMonitoringModule;
  ruleBook: NotificationRuleBook;
  engine: NotificationEngine;
  metrics: AuthMetrics;
}

export interface CreateAuthMonitoringOptions {
  store: PrincipalStore;
  provider: IdentityProvider;
  notifiers: Notifier[];
  mode?: CombinationMode;
  rules?: Array<Omit<NotificationRule, 'id'>>;
  rulesFilePath?: string;
  attemptsLogPath?: string;
  now?: () => Date;
}

/** Monta o modulo completo e ja o liga ao IdentityProvider. */
export function createAuthMonitoring(options: CreateAuthMonitoringOptions): AuthMonitoringBundle {
  const ruleBook = new NotificationRuleBook({
    ...(options.rulesFilePath !== undefined ? { filePath: options.rulesFilePath } : {}),
  });
  if (ruleBook.list().length === 0) {
    for (const rule of options.rules ?? defaultRules()) ruleBook.addRule(rule);
  }

  const monitorRef: { current?: LoginMonitoringModule } = {};
  const engine = new NotificationEngine(options.store, options.notifiers, {
    ...(options.now !== undefined ? { now: options.now } : {}),
    markAttemptBreach: (attemptId) => monitorRef.current?.markBreach(attemptId) ?? false,
    disablePrincipalByUserId: (userId) => {
      const principal =
        options.store.getByEmail(userId) ?? options.store.list().find((p) => p.name === userId);
      if (principal === undefined) return false;
      return options.provider.disablePrincipal(principal.id) !== undefined;
    },
  });

  const monitor = new LoginMonitoringModule(ruleBook, engine, {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.attemptsLogPath !== undefined ? { attemptsLogPath: options.attemptsLogPath } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  monitorRef.current = monitor;
  monitor.attach(options.provider);

  return { monitor, ruleBook, engine, metrics: monitor.metrics };
}

/** Carrega tentativas de um arquivo JSONL (usado pelo CLI `metrics`). */
export function loadAttemptsFromLog(attemptsLogPath: string): AuthenticationRecord[] {
  if (!existsSync(attemptsLogPath)) return [];
  return readFileSync(attemptsLogPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuthenticationRecord);
}
