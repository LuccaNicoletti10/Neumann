/**
 * edge-control — src/core/transmit.ts
 * Transmissão digital com detailed view + porção do baseline (US 11,799,877).
 */

import type {
  ActivityAnomaly,
  DigitalTransmission,
  TransmissionKind,
} from 'contracts';

import type { BaselineStore } from './baseline.js';

export function buildTransmission(
  anomaly: ActivityAnomaly,
  opts: {
    type: TransmissionKind;
    recipients: string[];
    nextId: (prefix: string) => string;
    now: string;
    store: BaselineStore;
    subject?: string;
  },
): DigitalTransmission {
  const activity = anomaly.activity;
  const baselineDisplay = opts.store.display(activity.operatorId) ?? {
    typicalWorkHours: 'Unknown',
    typicalLocation: 'Unknown',
    typicalActions: [],
  };
  const detailedView = {
    time: activity.timestamp,
    actionType: activity.actionType,
    userIdentifier: activity.displayName,
    amountKB: activity.details.amountKB,
    sourceIP: activity.details.sourceIP,
    destinationIP: activity.details.destinationIP,
    location: activity.location,
    inconsistencyExplanation: anomaly.reason,
    baselineProfileDisplay: baselineDisplay,
  };
  const subject =
    opts.subject ?? `[SECURITY ALERT] Anomalous activity detected for ${anomaly.displayName}`;
  const body = [
    `User: ${anomaly.displayName}`,
    `Action: ${activity.actionType}`,
    `Time: ${activity.timestamp}`,
    `Location: ${activity.location}`,
    `Reason: ${anomaly.reason}`,
    `Severity: ${anomaly.severity}`,
    `Baseline hours: ${baselineDisplay.typicalWorkHours}`,
    `Baseline location: ${baselineDisplay.typicalLocation}`,
  ].join('\n');

  return {
    id: opts.nextId('tx'),
    anomalyId: anomaly.id,
    type: opts.type,
    subject,
    body,
    detailedView,
    recipients: [...opts.recipients],
    sentAt: opts.now,
    delivered: true,
    acknowledged: false,
  };
}
