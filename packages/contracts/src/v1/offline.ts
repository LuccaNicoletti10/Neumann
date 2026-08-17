/**
 * contracts — src/v1/offline.ts
 * Offline + deconflição multimaster (Passo 34). Shape congelado.
 *
 * US 8,515,912 — sharing/deconflicting em multimaster (version vectors).
 * US 9,569,070 — catálogo de conflitos ambíguos + resolução em lote (API, sem GUI).
 * US 8,364,642 / US 8,812,444 / US 9,275,069 — investigações desconectadas
 *   (snapshot autorizado, change sets, .base / .dsco).
 *
 * Gate: rede estabilizou → authorized_state(A) == authorized_state(B)
 * na porção compartilhável (partition + reorder + duplicate + drop + 3+ réplicas).
 * Snapshot autorizado = só o que o principal vê; mutations offline reentram
 * no mesmo pipeline de conflito (sem ingest privilegiado).
 */

import type { PrincipalId } from './policy.js';

export type ReplicaId = string;
export type ObjectId = string;
export type LinkSetId = string;
export type { PrincipalId };
export type InvestigationId = string;
export type ChangeSetId = string;

/** Vetor de versão serializável (site → relógio). Ausente = 0. */
export type VersionVector = Record<string, number>;

export type VersionCompare = 'identical' | 'ordered' | 'concurrent';

export interface ReplicaObject {
  id: ObjectId;
  objectType: string;
  title: string;
  properties: Record<string, unknown>;
  photo?: string;
  deleted?: boolean;
  resolvedWith: ObjectId[];
  /** Principais que podem ver este objeto no snapshot autorizado. */
  aclPrincipals: PrincipalId[];
  version: VersionVector;
}

export interface ReplicaLink {
  id: string;
  source: ObjectId;
  target: ObjectId;
  linkType: string;
  symmetric: boolean;
}

export interface ReplicaLinkSet {
  id: LinkSetId;
  objectA: ObjectId;
  objectB: ObjectId;
  links: ReplicaLink[];
  version: VersionVector;
}

export type ReplicaUpdateKind = 'object' | 'linkSet';

export interface ReplicaUpdate {
  id: string;
  replicaId: ReplicaId;
  kind: ReplicaUpdateKind;
  objectId?: ObjectId;
  linkSetId?: LinkSetId;
  version: VersionVector;
  object?: ReplicaObject;
  linkSet?: ReplicaLinkSet;
}

export type ApplyStatus = 'applied' | 'discarded' | 'conflict';

export type DataConflictType =
  | 'objectType'
  | 'title'
  | 'photo'
  | 'deletion'
  | 'geotime'
  | 'resolution';

export const DATA_CONFLICT_TYPES: readonly DataConflictType[] = [
  'objectType',
  'title',
  'photo',
  'deletion',
  'geotime',
  'resolution',
];

export type TitleSubType =
  | 'caseDifference'
  | 'punctuationDifference'
  | 'punctuationAndCaseDifference'
  | 'dissimilarTitles';

export const TITLE_SUB_TYPES: readonly TitleSubType[] = [
  'caseDifference',
  'punctuationDifference',
  'punctuationAndCaseDifference',
  'dissimilarTitles',
];

export type GeotimeSubType =
  | 'dissimilarGeotime'
  | 'geographicLocationDifference'
  | 'geographicDataMapDifference'
  | 'elevationDataDifference'
  | 'timeIntervalConflict'
  | 'oursMultipleProperties'
  | 'theirsMultipleProperties'
  | 'bothMultipleProperties'
  | 'timeZoneDifferenceOffset';

export const GEOTIME_SUB_TYPES: readonly GeotimeSubType[] = [
  'dissimilarGeotime',
  'geographicLocationDifference',
  'geographicDataMapDifference',
  'elevationDataDifference',
  'timeIntervalConflict',
  'oursMultipleProperties',
  'theirsMultipleProperties',
  'bothMultipleProperties',
  'timeZoneDifferenceOffset',
];

export const GEOTIME_PROPERTY_KEYS = [
  'startDate',
  'endDate',
  'location',
  'latitude',
  'longitude',
  'elevation',
  'timeZone',
] as const;

export interface AmbiguousDataConflict {
  id: string;
  type: DataConflictType;
  subType?: TitleSubType | GeotimeSubType | string;
  objectId?: ObjectId;
  linkSetId?: LinkSetId;
  localObject?: ReplicaObject;
  peerObject?: ReplicaObject;
  localLinkSet?: ReplicaLinkSet;
  peerLinkSet?: ReplicaLinkSet;
  localVersion: VersionVector;
  incomingVersion: VersionVector;
  localDeploymentName: string;
  peerDeploymentName: string;
  description: string;
  resolved: boolean;
  detectedAt: string;
}

export interface ConflictGroup {
  subType: string;
  conflicts: AmbiguousDataConflict[];
  count: number;
  displayName: string;
}

export type ConflictResolution =
  | { action: 'acceptLocal' }
  | { action: 'acceptPeer' }
  | { action: 'merge' }
  | { action: 'resolveAll' }
  | { action: 'unresolveAll' };

export interface ConflictFilterView {
  totalCount: number;
  selectedType?: DataConflictType;
  availableTypes: DataConflictType[];
  typeCounts: Record<DataConflictType, number>;
  groupedConflicts: ConflictGroup[];
}

export interface ConflictResolutionView {
  conflicts: AmbiguousDataConflict[];
  resolutionOptions: {
    acceptLocal: boolean;
    acceptPeer: boolean;
    merge: boolean;
    resolveAll: boolean;
    unresolveAll: boolean;
  };
}

export type ChangeOperation = 'create' | 'edit' | 'delete';

export interface ChangeRecord {
  obj_comp_id: string;
  obj_id: ObjectId;
  logical_clk: number;
  deleted: boolean;
  value: unknown;
  operation: ChangeOperation;
}

export interface ChangeSet {
  id: ChangeSetId;
  logicalClockValue: number;
  records: ChangeRecord[];
  objectIds: ObjectId[];
}

export interface Investigation {
  id: InvestigationId;
  name: string;
  description?: string;
  principal: PrincipalId;
  changeSets: ChangeSet[];
  lastAcknowledgedChangeSetId?: ChangeSetId;
}

export interface BaseFile {
  investigationId: InvestigationId;
  principal: PrincipalId;
  changeSets: ChangeSet[];
  objects: ReplicaObject[];
  linkSets: ReplicaLinkSet[];
  lastChangeSetId: ChangeSetId;
  randomIdCount?: number;
}

export interface DiscoFile {
  investigationId: InvestigationId;
  changeSets: ChangeSet[];
  lastAcknowledgedChangeSetId: ChangeSetId;
  replicaUpdates: ReplicaUpdate[];
  randomIdsConsumed?: number;
}

export function isDataConflictType(value: string): value is DataConflictType {
  return (DATA_CONFLICT_TYPES as readonly string[]).includes(value);
}

export function buildGoldenReplicaObject(): ReplicaObject {
  return {
    id: 'obj-1',
    objectType: 'Person',
    title: 'Ada Lovelace',
    properties: { city: 'London' },
    resolvedWith: [],
    aclPrincipals: ['alice', 'bob'],
    version: { A: 1, B: 0, C: 0 },
  };
}

export function buildGoldenVersionVector(): VersionVector {
  return { A: 1, B: 0, C: 0 };
}

export function assertVersionVector(vv: VersionVector): void {
  if (vv === null || typeof vv !== 'object' || Array.isArray(vv)) {
    throw new Error('VersionVector: objeto site→número obrigatório');
  }
  for (const [k, v] of Object.entries(vv)) {
    if (!k) throw new Error('VersionVector: site id vazio');
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`VersionVector: relógio inválido em ${k}`);
    }
  }
}

export function assertReplicaObject(obj: ReplicaObject): void {
  if (!obj.id) throw new Error('ReplicaObject: id obrigatório');
  if (!obj.objectType) throw new Error('ReplicaObject: objectType obrigatório');
  if (typeof obj.title !== 'string') throw new Error('ReplicaObject: title obrigatório');
  if (!obj.properties || typeof obj.properties !== 'object') {
    throw new Error('ReplicaObject: properties obrigatório');
  }
  if (!Array.isArray(obj.resolvedWith)) throw new Error('ReplicaObject: resolvedWith obrigatório');
  if (!Array.isArray(obj.aclPrincipals)) throw new Error('ReplicaObject: aclPrincipals obrigatório');
  assertVersionVector(obj.version);
}

function sortedRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    const v = value[k];
    out[k] = v;
  }
  return out;
}

function sortedVector(vv: VersionVector): VersionVector {
  const out: VersionVector = {};
  for (const k of Object.keys(vv).sort()) {
    out[k] = vv[k] ?? 0;
  }
  return out;
}

export function objectVisibleTo(obj: ReplicaObject, principal: PrincipalId): boolean {
  return obj.aclPrincipals.includes(principal);
}

/**
 * Estado autorizado canónico: objetos visíveis ao principal, ordenados.
 * É o valor comparado no gate do Passo 34.
 */
export function canonicalAuthorizedState(
  objects: readonly ReplicaObject[],
  principal: PrincipalId,
): string {
  const visible = objects
    .filter((o) => objectVisibleTo(o, principal))
    .map((o) => ({
      id: o.id,
      objectType: o.objectType,
      title: o.title,
      properties: sortedRecord(o.properties),
      photo: o.photo ?? null,
      deleted: o.deleted ?? false,
      resolvedWith: [...o.resolvedWith].sort(),
      version: sortedVector(o.version),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(visible);
}
