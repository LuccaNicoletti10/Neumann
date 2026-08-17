/**
 * edge-control — src/core/detect.ts
 * Anomalia vs baseline: horário, local, ação, first-time CA, volume.
 */

import type {
  ActivityAnomaly,
  ActivityUnit,
  AnomalySeverity,
  EdgeSourceKind,
} from 'contracts';
import { isEdgeSourceKind } from 'contracts';

import type { BaselineStore } from './baseline.js';

export function hourUtc(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return new Date(t).getUTCHours();
}

const MODIFY_RE = /\b(modify|change|update|delete|install|uninstall|add|remove)\b/i;

function severityOf(reason: string): AnomalySeverity {
  if (reason.includes('certificate authority') || reason.includes('unusually large')) return 'high';
  if (reason.includes('outside typical') || reason.includes('unusual')) return 'medium';
  return 'low';
}

export function activityFromEventPayload(
  eventId: string,
  principal: string,
  sourceObject: string,
  occurredAt: string,
  payload: Record<string, unknown>,
  displayName: string,
): ActivityUnit {
  const kind: EdgeSourceKind = isEdgeSourceKind(sourceObject) ? sourceObject : 'packetLog';
  const actionType = String(payload.actionType ?? payload.action ?? 'unknown');
  return {
    id: eventId,
    operatorId: String(payload.operatorId ?? principal),
    displayName: String(payload.displayName ?? displayName),
    sourceId: String(payload.sourceId ?? sourceObject),
    sourceKind: kind,
    actionType,
    timestamp: occurredAt,
    location: String(payload.location ?? ''),
    details: {
      amountKB: typeof payload.amountKB === 'number' ? payload.amountKB : undefined,
      sourceIP: typeof payload.sourceIP === 'string' ? payload.sourceIP : undefined,
      destinationIP: typeof payload.destinationIP === 'string' ? payload.destinationIP : undefined,
      certificateName: typeof payload.certificateName === 'string' ? payload.certificateName : undefined,
    },
    eventId,
  };
}

export function detectAnomalies(
  activity: ActivityUnit,
  store: BaselineStore,
  nextId: (prefix: string) => string,
  now: string,
): ActivityAnomaly[] {
  const baseline = store.get(activity.operatorId);
  if (!baseline) return [];

  const reasons: string[] = [];
  const hour = hourUtc(activity.timestamp);
  const access = baseline.typicalAccess[activity.sourceKind];

  if (activity.actionType === 'modify certificate authority') {
    const ca = activity.details.certificateName ?? 'unknown CA';
    if (!store.hasModifiedCA(activity.operatorId, ca)) {
      reasons.push(
        `User ${activity.displayName} modified certificate authority "${ca}" for the first time.`,
      );
      store.recordCertificateModification(activity.operatorId, ca);
    }
  }

  const inWork = hour >= baseline.typicalWorkHoursStart && hour < baseline.typicalWorkHoursEnd;
  const inSource = access
    ? hour >= access.startHour && hour < access.endHour
    : true;
  if (!inWork || !inSource) {
    reasons.push(
      `Activity at ${activity.timestamp} outside typical work hours (${baseline.typicalWorkHoursStart}:00-${baseline.typicalWorkHoursEnd}:00)`,
    );
  }

  if (activity.location && activity.location !== baseline.typicalLocation) {
    reasons.push(
      `Activity from ${activity.location} (unusual; typical: ${baseline.typicalLocation})`,
    );
  }

  if (activity.actionType === 'data transmission' && activity.details.amountKB !== undefined) {
    const amount = activity.details.amountKB;
    const range = access?.typicalAmountRange;
    if (range && (amount < range.min || amount > range.max)) {
      reasons.push(`Data transmission amount ${amount}KB deviates from typical range ${range.min}-${range.max}KB.`);
    } else if (!range && amount > 1000) {
      reasons.push(`Data transmission amount ${amount}KB is unusually large.`);
    }
  }

  const typical = access?.typicalActionTypes ?? [];
  const isTypical = typical.some((a) => activity.actionType.toLowerCase().includes(a.toLowerCase()));
  const firstTimeAlready = reasons.some((r) => r.includes('first time'));
  if (!isTypical && !firstTimeAlready && MODIFY_RE.test(activity.actionType)) {
    reasons.push(`Unusual modifying action "${activity.actionType}" on ${activity.sourceKind}`);
  } else if (!isTypical && !firstTimeAlready && !MODIFY_RE.test(activity.actionType)) {
    if (
      activity.actionType === 'data transmission' ||
      activity.actionType === 'data access' ||
      activity.actionType === 'modify certificate authority'
    ) {
      reasons.push(`Action "${activity.actionType}" on ${activity.sourceKind} is not typical for this user.`);
    }
  }

  return reasons.map((reason) => ({
    id: nextId('anom'),
    operatorId: activity.operatorId,
    displayName: activity.displayName,
    activityId: activity.id,
    activity,
    reason,
    severity: severityOf(reason),
    detectedAt: now,
    acknowledged: false,
  }));
}
