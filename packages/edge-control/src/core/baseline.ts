/**
 * edge-control — src/core/baseline.ts
 * Baseline de operador (US20250233873A1 / US 11,799,877).
 */

import {
  EDGE_SOURCE_KINDS,
  type BaselineProfile,
  type BaselineProfileDisplay,
  type EdgeOperator,
  type EdgeSourceAccessPattern,
  type EdgeSourceKind,
} from 'contracts';

const DEFAULT_ACTIONS: Record<EdgeSourceKind, string[]> = {
  packetLog: ['view', 'search'],
  driverLog: ['view'],
  sslCertificateAuthority: ['view', 'verify'],
  programmableLogicController: ['monitor', 'adjust'],
  smtpLog: ['view', 'search'],
  webAccessLog: ['view', 'search'],
  serviceRepo: ['update', 'view'],
  networkDrive: ['read', 'write'],
  workstationPerformanceLog: ['view', 'monitor'],
  workstationNetworkTraffic: ['view', 'monitor'],
};

export function createBaseline(operator: EdgeOperator): BaselineProfile {
  const typicalAccess: BaselineProfile['typicalAccess'] = {};
  for (const kind of EDGE_SOURCE_KINDS) {
    const pattern: EdgeSourceAccessPattern = {
      frequency: 'daily',
      typicalActionTypes: [...DEFAULT_ACTIONS[kind]],
      startHour: operator.workHoursStart,
      endHour: operator.workHoursEnd,
    };
    typicalAccess[kind] = pattern;
  }
  typicalAccess.sslCertificateAuthority = {
    frequency: 'monthly',
    typicalActionTypes: ['view', 'verify'],
    startHour: operator.workHoursStart,
    endHour: operator.workHoursEnd,
  };
  return {
    operatorId: operator.id,
    typicalWorkHoursStart: operator.workHoursStart,
    typicalWorkHoursEnd: operator.workHoursEnd,
    typicalLocation: operator.typicalLocation,
    typicalAccess,
    modifiedCertificateAuthorities: [],
  };
}

export interface BaselineStore {
  put(profile: BaselineProfile): BaselineProfile;
  get(operatorId: string): BaselineProfile | undefined;
  recordCertificateModification(operatorId: string, caName: string): void;
  hasModifiedCA(operatorId: string, caName: string): boolean;
  display(operatorId: string): BaselineProfileDisplay | undefined;
}

export function createBaselineStore(): BaselineStore {
  const profiles = new Map<string, BaselineProfile>();
  return {
    put(profile) {
      profiles.set(profile.operatorId, profile);
      return profile;
    },
    get(operatorId) {
      return profiles.get(operatorId);
    },
    recordCertificateModification(operatorId, caName) {
      const p = profiles.get(operatorId);
      if (!p) return;
      if (!p.modifiedCertificateAuthorities.includes(caName)) {
        p.modifiedCertificateAuthorities.push(caName);
      }
    },
    hasModifiedCA(operatorId, caName) {
      return profiles.get(operatorId)?.modifiedCertificateAuthorities.includes(caName) ?? false;
    },
    display(operatorId) {
      const p = profiles.get(operatorId);
      if (!p) return undefined;
      const typicalActions = [
        ...new Set(
          Object.values(p.typicalAccess).flatMap((a) => a?.typicalActionTypes ?? []),
        ),
      ].slice(0, 5);
      return {
        typicalWorkHours: `${p.typicalWorkHoursStart}:00-${p.typicalWorkHoursEnd}:00`,
        typicalLocation: p.typicalLocation,
        typicalActions,
      };
    },
  };
}
