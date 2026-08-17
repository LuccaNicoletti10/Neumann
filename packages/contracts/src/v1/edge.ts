/**
 * contracts — src/v1/edge.ts
 * Fonte remota / edge + supervisory control (Passo 32). Shape congelado.
 *
 * US 11,799,877 / US 12,261,861 / US20250233873A1 —
 * ingestão edge pelo Connector (`subscribe`) + baseline/anomalia/transmissão.
 * Kernel: CanonicalEvent; sem GUI; sem vertical de fábrica.
 */

import type { CanonicalEvent } from './canonical-event.js';

/** Kinds de fonte monitorada (lista das patentes — não é domínio de negócio). */
export type EdgeSourceKind =
  | 'packetLog'
  | 'driverLog'
  | 'sslCertificateAuthority'
  | 'programmableLogicController'
  | 'smtpLog'
  | 'webAccessLog'
  | 'serviceRepo'
  | 'networkDrive'
  | 'workstationPerformanceLog'
  | 'workstationNetworkTraffic';

export const EDGE_SOURCE_KINDS: readonly EdgeSourceKind[] = [
  'packetLog',
  'driverLog',
  'sslCertificateAuthority',
  'programmableLogicController',
  'smtpLog',
  'webAccessLog',
  'serviceRepo',
  'networkDrive',
  'workstationPerformanceLog',
  'workstationNetworkTraffic',
];

export interface EdgeOperator {
  id: string;
  displayName: string;
  typicalLocation: string;
  /** Hora UTC 0–23. */
  workHoursStart: number;
  workHoursEnd: number;
}

export interface EdgeSourceAccessPattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'rarely';
  typicalActionTypes: string[];
  typicalAmountRange?: { min: number; max: number };
  startHour: number;
  endHour: number;
}

export interface BaselineProfile {
  operatorId: string;
  typicalWorkHoursStart: number;
  typicalWorkHoursEnd: number;
  typicalLocation: string;
  typicalAccess: Partial<Record<EdgeSourceKind, EdgeSourceAccessPattern>>;
  /** CAs já modificadas (first-time check). */
  modifiedCertificateAuthorities: string[];
}

/** Unidade de atividade: tempo + actionType + user (claims). */
export interface ActivityUnit {
  id: string;
  operatorId: string;
  displayName: string;
  sourceId: string;
  sourceKind: EdgeSourceKind;
  actionType: string;
  timestamp: string;
  location: string;
  details: {
    amountKB?: number;
    sourceIP?: string;
    destinationIP?: string;
    certificateName?: string;
    [key: string]: unknown;
  };
  eventId?: string;
  isConsistentWithBaseline?: boolean;
}

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ActivityAnomaly {
  id: string;
  operatorId: string;
  displayName: string;
  activityId: string;
  activity: ActivityUnit;
  reason: string;
  severity: AnomalySeverity;
  detectedAt: string;
  acknowledged: boolean;
  remedialAction?: string;
}

export interface BaselineProfileDisplay {
  typicalWorkHours: string;
  typicalLocation: string;
  typicalActions: string[];
}

export interface ActivityDetailedView {
  time: string;
  actionType: string;
  userIdentifier: string;
  amountKB?: number;
  sourceIP?: string;
  destinationIP?: string;
  location?: string;
  inconsistencyExplanation: string;
  baselineProfileDisplay: BaselineProfileDisplay;
}

export type TransmissionKind = 'email' | 'sms' | 'pushNotification' | 'dashboardAlert' | 'urgentMessage';

export interface DigitalTransmission {
  id: string;
  anomalyId: string;
  type: TransmissionKind;
  subject: string;
  body: string;
  detailedView: ActivityDetailedView;
  recipients: string[];
  sentAt: string;
  delivered: boolean;
  acknowledged: boolean;
}

export interface DashboardActivityRow {
  time: string;
  actionType: string;
  userIdentifier: string;
  isConsistentWithBaseline: boolean;
  activityId: string;
}

export interface ActivityDashboardView {
  activities: DashboardActivityRow[];
  anomalies: ActivityAnomaly[];
  timeRange: { start: string; end: string };
}

export function buildGoldenActivityUnit(): ActivityUnit {
  return {
    id: 'act-1',
    operatorId: 'op-1',
    displayName: 'Ada',
    sourceId: 'src-packet',
    sourceKind: 'packetLog',
    actionType: 'view',
    timestamp: '2024-06-01T12:00:00.000Z',
    location: 'nyc',
    details: {},
  };
}

export function assertActivityUnit(unit: ActivityUnit): void {
  if (!unit.id) throw new Error('ActivityUnit: id obrigatório');
  if (!unit.operatorId) throw new Error('ActivityUnit: operatorId obrigatório');
  if (!unit.actionType) throw new Error('ActivityUnit: actionType obrigatório');
  if (!unit.timestamp) throw new Error('ActivityUnit: timestamp obrigatório');
}

export function isEdgeSourceKind(value: string): value is EdgeSourceKind {
  return (EDGE_SOURCE_KINDS as readonly string[]).includes(value);
}

export type { CanonicalEvent };
