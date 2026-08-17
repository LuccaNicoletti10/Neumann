/**
 * edge-control — src/core/server.ts
 * Control server: ingest CanonicalEvent → activity → anomaly → transmission.
 */

import { createDeterministicClock, createIdGenerator } from 'connector-sdk';
import {
  assertCanonicalEvent,
  type ActivityAnomaly,
  type ActivityDashboardView,
  type ActivityUnit,
  type CanonicalEvent,
  type DigitalTransmission,
  type EdgeOperator,
  type TransmissionKind,
} from 'contracts';

import { createBaseline, createBaselineStore, type BaselineStore } from './baseline.js';
import { activityFromEventPayload, detectAnomalies } from './detect.js';
import { buildTransmission } from './transmit.js';

export interface EdgeControlServer {
  registerOperator(op: EdgeOperator): void;
  ingest(event: CanonicalEvent): { activity: ActivityUnit; anomalies: ActivityAnomaly[] };
  activities(): ActivityUnit[];
  anomalies(): ActivityAnomaly[];
  transmissions(): DigitalTransmission[];
  sendAlert(anomaly: ActivityAnomaly, type: TransmissionKind, recipients: string[]): DigitalTransmission;
  acknowledge(anomalyId: string): void;
  takeRemedialAction(anomalyId: string, action: string): void;
  dashboard(timeRange: { start: string; end: string }): ActivityDashboardView;
  baselines(): BaselineStore;
}

export function createEdgeControlServer(opts: {
  clock?: () => string;
  nextId?: (prefix: string) => string;
  autoAlert?: boolean;
  alertRecipients?: string[];
} = {}): EdgeControlServer {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const store = createBaselineStore();
  const operators = new Map<string, EdgeOperator>();
  const units: ActivityUnit[] = [];
  const found: ActivityAnomaly[] = [];
  const sent: DigitalTransmission[] = [];
  const autoAlert = opts.autoAlert ?? true;
  const recipients = opts.alertRecipients ?? ['security@example.com'];

  return {
    registerOperator(op) {
      operators.set(op.id, op);
      store.put(createBaseline(op));
    },

    ingest(event) {
      assertCanonicalEvent(event);
      const op = operators.get(event.principal);
      const activity = activityFromEventPayload(
        event.event_id,
        event.principal,
        event.source_object,
        event.occurred_at,
        event.payload,
        op?.displayName ?? event.principal,
      );
      const anomalies = detectAnomalies(activity, store, nextId, clock());
      activity.isConsistentWithBaseline = anomalies.length === 0;
      units.push(activity);
      for (const a of anomalies) {
        found.push(a);
        if (autoAlert) {
          sent.push(
            buildTransmission(a, {
              type: 'dashboardAlert',
              recipients,
              nextId,
              now: clock(),
              store,
            }),
          );
        }
      }
      return { activity, anomalies };
    },

    activities() {
      return [...units];
    },
    anomalies() {
      return [...found];
    },
    transmissions() {
      return [...sent];
    },

    sendAlert(anomaly, type, to) {
      const tx = buildTransmission(anomaly, {
        type,
        recipients: to,
        nextId,
        now: clock(),
        store,
      });
      sent.push(tx);
      return tx;
    },

    acknowledge(anomalyId) {
      const a = found.find((x) => x.id === anomalyId);
      if (a) a.acknowledged = true;
    },

    takeRemedialAction(anomalyId, action) {
      const a = found.find((x) => x.id === anomalyId);
      if (a) a.remedialAction = action;
    },

    dashboard(timeRange) {
      const inRange = units.filter(
        (u) => u.timestamp >= timeRange.start && u.timestamp <= timeRange.end,
      );
      const anoms = found.filter(
        (a) => a.detectedAt >= timeRange.start && a.detectedAt <= timeRange.end,
      );
      return {
        activities: inRange.map((u) => ({
          time: u.timestamp,
          actionType: u.actionType,
          userIdentifier: u.displayName,
          isConsistentWithBaseline: u.isConsistentWithBaseline ?? !anoms.some((a) => a.activityId === u.id),
          activityId: u.id,
        })),
        anomalies: anoms,
        timeRange,
      };
    },

    baselines() {
      return store;
    },
  };
}
