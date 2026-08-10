/**
 * notification-engine.ts — NotificationEngine.
 *
 * Componente da patente US 8,763,078 (implementacao funcional independente):
 * resolve o notification handle (email/sms) no PrincipalStore, monta a mensagem
 * (localizacao, IP e QUAIS regras dispararam), envia via Notifier injetavel e
 * guarda o historico de notificacoes. O usuario pode responder a notificacao:
 * confirmAttempt (estava ciente) ou reportBreach (marca a tentativa como
 * suspeita e pode disparar acao: desabilitar o principal).
 */

import { randomUUID } from 'node:crypto';
import type { AuthenticationRecord } from './auth-record.js';
import { locationKey, type RuleDecision } from './rules.js';
import type { Notifier, NotificationChannel } from './notifiers.js';
import type { Principal, PrincipalStore } from '../identity/principal-store.js';

export interface NotificationRecord {
  notificationId: string;
  attemptId: string;
  userId: string;
  locationKey: string;
  message: string;
  recipients: Array<{ channel: NotificationChannel; to: string }>;
  triggeredRules: Array<{ ruleId: string; ruleName: string; detail: string }>;
  sentAt: string;
  /** Resposta do usuario: 'confirmed' | 'breach' | undefined (sem resposta). */
  response?: 'confirmed' | 'breach';
}

export interface NotificationEngineOptions {
  now?: () => Date;
  /** Callback para marcar a tentativa como suspeita (ligado ao LoginMonitoringModule). */
  markAttemptBreach?: (attemptId: string) => boolean;
  /** Callback para desabilitar o principal associado a credencial (ligado ao IdentityProvider). */
  disablePrincipalByUserId?: (userId: string) => boolean;
}

export class NotificationEngine {
  private readonly store: PrincipalStore;
  private readonly notifiers: Notifier[];
  private readonly now: () => Date;
  private readonly history: NotificationRecord[] = [];
  private readonly markAttemptBreach?: (attemptId: string) => boolean;
  private readonly disablePrincipalByUserId?: (userId: string) => boolean;

  constructor(store: PrincipalStore, notifiers: Notifier[], options: NotificationEngineOptions = {}) {
    this.store = store;
    this.notifiers = notifiers;
    this.now = options.now ?? (() => new Date());
    if (options.markAttemptBreach !== undefined) this.markAttemptBreach = options.markAttemptBreach;
    if (options.disablePrincipalByUserId !== undefined) {
      this.disablePrincipalByUserId = options.disablePrincipalByUserId;
    }
  }

  listHistory(): NotificationRecord[] {
    return [...this.history];
  }

  buildMessage(attempt: AuthenticationRecord, decision: RuleDecision): string {
    const lines = [
      `Alerta de autenticacao para a credencial "${attempt.userId}".`,
      `Resultado: ${attempt.success ? 'SUCESSO' : 'FALHA'}.`,
      `Quando (UTC): ${attempt.timestamp}.`,
      `IP de origem: ${attempt.ip}.`,
    ];
    if (attempt.location !== undefined) {
      lines.push(`Localizacao aproximada: lat ${attempt.location.lat}, lon ${attempt.location.lon}.`);
    }
    if (attempt.userAgent !== undefined) lines.push(`User-Agent: ${attempt.userAgent}.`);
    if (decision.triggeredRules.length > 0) {
      lines.push('Regras que dispararam:');
      for (const rule of decision.triggeredRules) {
        lines.push(`- ${rule.ruleName} (${rule.type}): ${rule.detail}`);
      }
    }
    lines.push('Se foi voce, confirme a tentativa; caso contrario, reporte a violacao.');
    return lines.join('\n');
  }

  /** Envia notificacao para o dono da credencial + destinatarios adicionais das regras. */
  async notify(attempt: AuthenticationRecord, decision: RuleDecision): Promise<NotificationRecord> {
    const message = this.buildMessage(attempt, decision);
    const recipients = this.resolveRecipients(attempt.userId, decision.additionalRecipients);
    const record: NotificationRecord = {
      notificationId: randomUUID(),
      attemptId: attempt.attemptId,
      userId: attempt.userId,
      locationKey: locationKey(attempt),
      message,
      recipients,
      triggeredRules: decision.triggeredRules.map((r) => ({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        detail: r.detail,
      })),
      sentAt: this.now().toISOString(),
    };
    for (const recipient of recipients) {
      const outgoing = {
        channel: recipient.channel,
        to: recipient.to,
        subject: `[seguranca] tentativa de autenticacao em ${attempt.userId}`,
        body: message,
      };
      for (const notifier of this.notifiers) await notifier.send(outgoing);
    }
    this.history.push(record);
    return record;
  }

  /** Usuario respondeu "fui eu". */
  confirmAttempt(attemptId: string): NotificationRecord[] {
    const related = this.history.filter((n) => n.attemptId === attemptId);
    for (const record of related) record.response = 'confirmed';
    return related;
  }

  /**
   * Usuario respondeu "nao fui eu": marca a tentativa como suspeita e, se
   * pedido, desabilita o principal associado a credencial.
   */
  reportBreach(attemptId: string, options: { disablePrincipal?: boolean } = {}): {
    notifications: NotificationRecord[];
    breachMarked: boolean;
    principalDisabled: boolean;
  } {
    const related = this.history.filter((n) => n.attemptId === attemptId);
    for (const record of related) record.response = 'breach';
    const breachMarked = this.markAttemptBreach?.(attemptId) ?? false;
    let principalDisabled = false;
    if (options.disablePrincipal === true) {
      const userId = related[0]?.userId;
      if (userId !== undefined) {
        principalDisabled = this.disablePrincipalByUserId?.(userId) ?? false;
      }
    }
    return { notifications: related, breachMarked, principalDisabled };
  }

  private resolveRecipients(
    userId: string,
    additionalRecipients: string[],
  ): Array<{ channel: NotificationChannel; to: string }> {
    const resolved: Array<{ channel: NotificationChannel; to: string }> = [];
    const seen = new Set<string>();
    const pushHandles = (principal: Principal | undefined, fallback: string) => {
      const handles = principal?.notificationHandles ?? {};
      const entries: Array<{ channel: NotificationChannel; to: string }> = [];
      if (handles.email !== undefined) entries.push({ channel: 'email', to: handles.email });
      if (handles.sms !== undefined) entries.push({ channel: 'sms', to: handles.sms });
      if (entries.length === 0) entries.push({ channel: 'email', to: fallback });
      for (const entry of entries) {
        const key = `${entry.channel}:${entry.to}`;
        if (!seen.has(key)) {
          seen.add(key);
          resolved.push(entry);
        }
      }
    };
    pushHandles(this.findPrincipal(userId), userId);
    for (const extra of additionalRecipients) {
      if (extra.includes('@')) {
        const key = `email:${extra}`;
        if (!seen.has(key)) {
          seen.add(key);
          resolved.push({ channel: 'email', to: extra });
        }
      } else {
        pushHandles(this.findPrincipal(extra), extra);
      }
    }
    return resolved;
  }

  private findPrincipal(userIdOrName: string): Principal | undefined {
    return (
      this.store.getByEmail(userIdOrName) ??
      this.store.list().find((p) => p.name === userIdOrName)
    );
  }
}
