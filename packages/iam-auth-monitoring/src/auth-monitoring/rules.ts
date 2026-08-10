/**
 * rules.ts — NotificationRules e motor de avaliacao baseado em regras.
 *
 * Componente da patente US 8,763,078 (implementacao funcional independente):
 * conjunto configuravel de regras (admin pode adicionar/remover/habilitar/
 * desabilitar) avaliadas a cada tentativa de autenticacao para decidir se
 * notifica e quem. Regras suportadas:
 *   - user-whitelist: nao notificar usuarios listados;
 *   - network-whitelist: nao notificar IPs/redes listados (exato ou CIDR v4);
 *   - once-per-location-per-day: no maximo uma notificacao por localizacao/dia;
 *   - notify-only-on-success: so notifica tentativas bem-sucedidas;
 *   - multi-user: usuarios de alto risco -> notifica o usuario + destinatarios extras;
 *   - location-based: distancia (haversine) acima do limiar -> notifica;
 *   - time-window: janela do dia sem notificacoes;
 *   - latency-based: "impossible travel" — velocidade implicita entre
 *     tentativas maior que a maxima configurada -> notifica.
 * Modo de combinacao configuravel: ALL ou ANY.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuthenticationRecord, GeoLocation } from './auth-record.js';
import type { NotificationRecord } from './notification-engine.js';

export type RuleType =
  | 'user-whitelist'
  | 'network-whitelist'
  | 'once-per-location-per-day'
  | 'notify-only-on-success'
  | 'multi-user'
  | 'location-based'
  | 'time-window'
  | 'latency-based';

/** Regras 'suppress' vetam notificacao; regras 'notify' pedem notificacao. */
export const RULE_KIND: Record<RuleType, 'suppress' | 'notify'> = {
  'user-whitelist': 'suppress',
  'network-whitelist': 'suppress',
  'once-per-location-per-day': 'suppress',
  'notify-only-on-success': 'suppress',
  'time-window': 'suppress',
  'multi-user': 'notify',
  'location-based': 'notify',
  'latency-based': 'notify',
};

export interface NotificationRule {
  id: string;
  type: RuleType;
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export type CombinationMode = 'ALL' | 'ANY';

export interface RuleContext {
  attempt: AuthenticationRecord;
  /** Tentativa bem-sucedida anterior do mesmo usuario (se houver). */
  previousAttempt?: AuthenticationRecord;
  /** Historico de notificacoes (para once-per-location-per-day). */
  notifications: NotificationRecord[];
  now: Date;
}

export interface RuleOutcome {
  ruleId: string;
  ruleName: string;
  type: RuleType;
  triggered: boolean;
  suppress: boolean;
  additionalRecipients: string[];
  detail: string;
}

export interface RuleDecision {
  notify: boolean;
  mode: CombinationMode;
  triggeredRules: RuleOutcome[];
  suppressedBy: RuleOutcome[];
  additionalRecipients: string[];
}

// ---------- helpers geograficos / de rede / de tempo ----------

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoLocation, b: GeoLocation): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Chave de localizacao com precisao ~1km (2 casas decimais); sem geo, usa o IP. */
export function locationKey(attempt: AuthenticationRecord): string {
  if (attempt.location !== undefined) {
    return `geo:${attempt.location.lat.toFixed(2)},${attempt.location.lon.toFixed(2)}`;
  }
  return `ip:${attempt.ip}`;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

export function ipMatchesNetwork(ip: string, network: string): boolean {
  if (!network.includes('/')) return ip === network;
  const [base, prefixStr] = network.split('/') as [string, string];
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Janela silenciosa, suportando janelas que cruzam meia-noite (ex.: 22 -> 6). */
export function isWithinQuietWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ---------- avaliacao individual ----------

const MIN_TRAVEL_DISTANCE_KM = 50;

export function evaluateRule(rule: NotificationRule, ctx: RuleContext): RuleOutcome {
  const base = {
    ruleId: rule.id,
    ruleName: rule.name,
    type: rule.type,
    triggered: false,
    suppress: false,
    additionalRecipients: [] as string[],
    detail: '',
  };
  const { attempt, previousAttempt } = ctx;

  switch (rule.type) {
    case 'user-whitelist': {
      const users = asStringList(rule.params['userIds']);
      if (users.includes(attempt.userId)) {
        return { ...base, suppress: true, detail: `usuario ${attempt.userId} na whitelist` };
      }
      return base;
    }
    case 'network-whitelist': {
      const networks = asStringList(rule.params['networks']);
      const matched = networks.find((n) => ipMatchesNetwork(attempt.ip, n));
      if (matched !== undefined) {
        return { ...base, suppress: true, detail: `ip ${attempt.ip} pertence a rede ${matched}` };
      }
      return base;
    }
    case 'once-per-location-per-day': {
      const key = locationKey(attempt);
      const already = ctx.notifications.some(
        (n) => n.locationKey === key && sameUtcDay(new Date(n.sentAt), ctx.now),
      );
      if (already) {
        return { ...base, suppress: true, detail: `ja notificado hoje para localizacao ${key}` };
      }
      return base;
    }
    case 'notify-only-on-success': {
      if (!attempt.success) {
        return { ...base, suppress: true, detail: 'tentativa falhou e regra exige sucesso' };
      }
      return base;
    }
    case 'multi-user': {
      const highRisk = asStringList(rule.params['highRiskUsers']);
      if (highRisk.includes(attempt.userId)) {
        return {
          ...base,
          triggered: true,
          additionalRecipients: asStringList(rule.params['additionalRecipients']),
          detail: `usuario de alto risco: ${attempt.userId}`,
        };
      }
      return base;
    }
    case 'location-based': {
      const thresholdKm = asNumber(rule.params['thresholdKm'], 100);
      if (previousAttempt?.location !== undefined && attempt.location !== undefined) {
        const distance = haversineKm(previousAttempt.location, attempt.location);
        if (distance > thresholdKm) {
          return {
            ...base,
            triggered: true,
            detail: `distancia ${distance.toFixed(1)}km > limiar ${thresholdKm}km`,
          };
        }
      }
      return base;
    }
    case 'time-window': {
      const startHour = asNumber(rule.params['quietStartHour'], 0);
      const endHour = asNumber(rule.params['quietEndHour'], 6);
      const hour = ctx.now.getUTCHours();
      if (isWithinQuietWindow(hour, startHour, endHour)) {
        return { ...base, suppress: true, detail: `janela silenciosa ${startHour}h-${endHour}h UTC` };
      }
      return base;
    }
    case 'latency-based': {
      const maxSpeedKmh = asNumber(rule.params['maxSpeedKmh'], 900);
      if (previousAttempt?.location !== undefined && attempt.location !== undefined) {
        const distance = haversineKm(previousAttempt.location, attempt.location);
        const deltaMs = Date.parse(attempt.timestamp) - Date.parse(previousAttempt.timestamp);
        const deltaHours = Math.max(deltaMs, 0) / 3_600_000;
        if (distance > MIN_TRAVEL_DISTANCE_KM) {
          const speed = deltaHours === 0 ? Number.POSITIVE_INFINITY : distance / deltaHours;
          if (speed > maxSpeedKmh) {
            return {
              ...base,
              triggered: true,
              detail: `viagem impossivel: ${distance.toFixed(1)}km em ${(deltaHours * 60).toFixed(0)}min (${Number.isFinite(speed) ? speed.toFixed(0) : 'inf'}km/h > ${maxSpeedKmh}km/h)`,
            };
          }
        }
      }
      return base;
    }
  }
}

// ---------- combinacao ----------

export function combineOutcomes(outcomes: RuleOutcome[], mode: CombinationMode): RuleDecision {
  const suppressedBy = outcomes.filter((o) => o.suppress);
  const triggered = outcomes.filter((o) => o.triggered);
  const additionalRecipients = [...new Set(triggered.flatMap((o) => o.additionalRecipients))];

  let notify = false;
  if (suppressedBy.length === 0) {
    const notifyOutcomes = outcomes.filter((o) => RULE_KIND[o.type] === 'notify');
    if (mode === 'ANY') {
      notify = notifyOutcomes.some((o) => o.triggered);
    } else {
      notify = notifyOutcomes.length > 0 && notifyOutcomes.every((o) => o.triggered);
    }
  }
  return { notify, mode, triggeredRules: triggered, suppressedBy, additionalRecipients };
}

// ---------- RuleBook (CRUD admin + avaliacao) ----------

interface RuleFileShape {
  rules: NotificationRule[];
}

export class NotificationRuleBook {
  private readonly rules = new Map<string, NotificationRule>();
  private readonly filePath?: string;

  constructor(options: { filePath?: string; initialRules?: NotificationRule[] } = {}) {
    if (options.filePath !== undefined) {
      this.filePath = options.filePath;
      this.loadFromDisk();
    }
    for (const rule of options.initialRules ?? []) this.rules.set(rule.id, rule);
  }

  addRule(input: Omit<NotificationRule, 'id'> & { id?: string }): NotificationRule {
    const rule: NotificationRule = { ...input, id: input.id ?? randomUUID() };
    this.rules.set(rule.id, rule);
    this.persist();
    return rule;
  }

  removeRule(id: string): boolean {
    const removed = this.rules.delete(id);
    if (removed) this.persist();
    return removed;
  }

  setEnabled(id: string, enabled: boolean): NotificationRule | undefined {
    const rule = this.rules.get(id);
    if (rule === undefined) return undefined;
    const next: NotificationRule = { ...rule, enabled };
    this.rules.set(id, next);
    this.persist();
    return next;
  }

  list(): NotificationRule[] {
    return [...this.rules.values()];
  }

  evaluate(ctx: RuleContext, mode: CombinationMode): RuleDecision {
    const enabled = this.list().filter((r) => r.enabled);
    const outcomes = enabled.map((rule) => evaluateRule(rule, ctx));
    return combineOutcomes(outcomes, mode);
  }

  private loadFromDisk(): void {
    if (this.filePath === undefined || !existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, 'utf8');
    if (raw.trim().length === 0) return;
    const parsed = JSON.parse(raw) as RuleFileShape;
    for (const rule of parsed.rules) this.rules.set(rule.id, rule);
  }

  private persist(): void {
    if (this.filePath === undefined) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const payload: RuleFileShape = { rules: this.list() };
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2));
    renameSync(tmp, this.filePath);
  }
}

/** Conjunto default razoavel: notifica em viagem impossivel OU mudanca grande de localizacao, respeitando whitelists e 1x/dia/localizacao. */
export function defaultRules(): Array<Omit<NotificationRule, 'id'>> {
  return [
    { type: 'user-whitelist', name: 'whitelist-usuarios', enabled: true, params: { userIds: [] } },
    { type: 'network-whitelist', name: 'whitelist-redes', enabled: true, params: { networks: ['10.0.0.0/8', '192.168.0.0/16'] } },
    { type: 'once-per-location-per-day', name: 'uma-notificacao-por-localizacao-por-dia', enabled: true, params: {} },
    { type: 'location-based', name: 'mudanca-de-localizacao', enabled: true, params: { thresholdKm: 100 } },
    { type: 'latency-based', name: 'viagem-impossivel', enabled: true, params: { maxSpeedKmh: 900 } },
  ];
}
