/**
 * Gerenciador de alertas do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "alert/notify" — quando uma execução periódica encontra
 * resultados NOVOS, o sistema notifica o usuário e/ou o time dele. Este
 * módulo resolve os destinatários (usuários da busca + membros dos times via
 * TeamDirectory, deduplicados), monta a mensagem (nome da busca, fontes,
 * contagem e amostra dos registros novos), dispara via Notifier e persiste o
 * histórico de alertas (alerts.jsonl — result storage).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AlertRecord, Clock, SampleRecord, SearchConfig } from './types.js';
import type { DataRecord } from './data-source.js';
import { appendJsonl, readJsonl } from './result-differ.js';

/**
 * Diretório de times: resolve os membros de um time para notificação.
 * Interface injetável (em produção seria um serviço de identidade).
 */
export interface TeamDirectory {
  /** Retorna os IDs de usuários membros do time. */
  membersOf(teamId: string): Promise<string[]>;
}

/** TeamDirectory simples em memória (mapa teamId -> userIds). */
export class InMemoryTeamDirectory implements TeamDirectory {
  constructor(private readonly teams: Record<string, string[]> = {}) {}

  membersOf(teamId: string): Promise<string[]> {
    return Promise.resolve(this.teams[teamId] ?? []);
  }
}

/** Canal de notificação. */
export interface Notifier {
  notify(alert: AlertRecord): Promise<void>;
}

/** Notifier que apenas loga no console (produção simples). */
export class ConsoleNotifier implements Notifier {
  notify(alert: AlertRecord): Promise<void> {
    for (const userId of alert.recipientUserIds) {
      console.log(`[notify:${userId}] ${alert.message}`);
    }
    return Promise.resolve();
  }
}

/** Notifier em memória (testes e inspeção via API/CLI). */
export class InMemoryNotifier implements Notifier {
  readonly sent: Array<{ userId: string; alert: AlertRecord }> = [];

  notify(alert: AlertRecord): Promise<void> {
    for (const userId of alert.recipientUserIds) {
      this.sent.push({ userId, alert });
    }
    return Promise.resolve();
  }
}

export const ALERT_SAMPLE_LIMIT = 5;

/**
 * AlertManager: gera AlertRecord quando há novos resultados, notifica os
 * destinatários e persiste o histórico.
 */
export class AlertManager {
  private readonly file: string;

  constructor(
    dataDir: string,
    private readonly teamDirectory: TeamDirectory,
    private readonly notifiers: Notifier[],
    private readonly clock: Clock,
  ) {
    this.file = join(dataDir, 'alerts.jsonl');
  }

  /**
   * Resolve destinatários efetivos: usuários da busca + membros dos times,
   * deduplicados e ordenados (determinístico).
   */
  async resolveRecipients(search: SearchConfig): Promise<string[]> {
    const recipients = new Set<string>(search.recipientUserIds);
    for (const teamId of search.teamIds) {
      const members = await this.teamDirectory.membersOf(teamId);
      for (const member of members) {
        recipients.add(member);
      }
    }
    return [...recipients].sort();
  }

  /**
   * Cria o alerta para os novos resultados, notifica os destinatários e
   * persiste. Deve ser chamado apenas quando há registros novos.
   */
  async createAndNotify(search: SearchConfig, newRecords: DataRecord[]): Promise<AlertRecord> {
    const recipients = await this.resolveRecipients(search);
    const sourceIds = [...new Set(newRecords.map((r) => r.sourceId))].sort();
    const sample: SampleRecord[] = newRecords.slice(0, ALERT_SAMPLE_LIMIT).map((r) => ({
      recordId: r.recordId,
      sourceId: r.sourceId,
      timestamp: r.timestamp,
      preview: previewOf(r),
    }));
    const message =
      `Busca periódica "${search.name}" encontrou ${newRecords.length} ` +
      `novo(s) registro(s) em ${sourceIds.length} fonte(s): ${sourceIds.join(', ')}.`;
    const alert: AlertRecord = {
      id: randomUUID(),
      searchId: search.id,
      searchName: search.name,
      sourceIds,
      newRecordCount: newRecords.length,
      sampleRecords: sample,
      recipientUserIds: recipients,
      message,
      createdAt: this.clock.now().toISOString(),
    };
    await appendJsonl(this.file, [alert]);
    for (const notifier of this.notifiers) {
      await notifier.notify(alert);
    }
    return alert;
  }

  /** Histórico de alertas, opcionalmente filtrado por busca. */
  async list(searchId?: string): Promise<AlertRecord[]> {
    const alerts = await readJsonl<AlertRecord>(this.file);
    return searchId === undefined ? alerts : alerts.filter((a) => a.searchId === searchId);
  }
}

/** Prévia curta e determinística do conteúdo de um registro. */
function previewOf(record: DataRecord): string {
  const entries = Object.entries(record.content)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const s = entries.join(', ');
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}