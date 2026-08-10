/**
 * metrics.ts — metricas do monitoramento de autenticacao.
 *
 * Componente da patente US 8,763,078 (implementacao independente): contadores
 * por usuario e por IP — tentativas, falhas, notificacoes enviadas e breaches
 * reportados — com snapshot() consolidado para dashboards/alertas.
 */

import type { AuthenticationRecord } from './auth-record.js';

export interface CounterSet {
  attempts: number;
  failures: number;
  notifications: number;
  breaches: number;
}

export interface MetricsSnapshot {
  totals: CounterSet;
  byUser: Record<string, CounterSet>;
  byIp: Record<string, CounterSet>;
}

function emptyCounters(): CounterSet {
  return { attempts: 0, failures: 0, notifications: 0, breaches: 0 };
}

export class AuthMetrics {
  private readonly byUser = new Map<string, CounterSet>();
  private readonly byIp = new Map<string, CounterSet>();
  private readonly totals = emptyCounters();

  recordAttempt(attempt: AuthenticationRecord): void {
    this.bump(attempt.userId, attempt.ip, 'attempts');
    if (!attempt.success) this.bump(attempt.userId, attempt.ip, 'failures');
  }

  recordNotification(userId: string, ip: string): void {
    this.bump(userId, ip, 'notifications');
  }

  recordBreach(userId: string, ip: string): void {
    this.bump(userId, ip, 'breaches');
  }

  snapshot(): MetricsSnapshot {
    const toRecord = (map: Map<string, CounterSet>): Record<string, CounterSet> => {
      const out: Record<string, CounterSet> = {};
      for (const [key, counters] of map) out[key] = { ...counters };
      return out;
    };
    return { totals: { ...this.totals }, byUser: toRecord(this.byUser), byIp: toRecord(this.byIp) };
  }

  private bump(userId: string, ip: string, field: keyof CounterSet): void {
    this.totals[field] += 1;
    const user = this.byUser.get(userId) ?? emptyCounters();
    user[field] += 1;
    this.byUser.set(userId, user);
    const perIp = this.byIp.get(ip) ?? emptyCounters();
    perIp[field] += 1;
    this.byIp.set(ip, perIp);
  }
}
