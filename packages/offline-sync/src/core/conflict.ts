/**
 * offline-sync — src/core/conflict.ts
 * US 9,569,070 — detecção, filtro, agrupamento, resolução em lote (sem GUI).
 */

import type {
  AmbiguousDataConflict,
  ConflictFilterView,
  ConflictGroup,
  ConflictResolution,
  ConflictResolutionView,
  DataConflictType,
  GeotimeSubType,
  ReplicaLinkSet,
  ReplicaObject,
  TitleSubType,
  VersionVector,
} from 'contracts';
import { DATA_CONFLICT_TYPES, GEOTIME_PROPERTY_KEYS } from 'contracts';

const TITLE_DISPLAY: Record<string, string> = {
  caseDifference: 'Case difference',
  punctuationDifference: 'Punctuation difference',
  punctuationAndCaseDifference: 'Punctuation and case difference',
  dissimilarTitles: 'Dissimilar titles',
  dissimilarGeotime: 'Dissimilar geotime information',
  geographicLocationDifference: 'Geographic location difference',
  geographicDataMapDifference: 'Geographic data map difference',
  elevationDataDifference: 'Elevation data difference',
  timeIntervalConflict: 'Time interval conflict',
  oursMultipleProperties: 'Ours: Multiple properties',
  theirsMultipleProperties: 'Theirs: Multiple properties',
  bothMultipleProperties: 'Both: Multiple properties',
  timeZoneDifferenceOffset: 'Time zone difference offset',
  uncategorized: 'Uncategorized',
};

const PUNCT = /[.,/#!$%^&*;:{}=\-_`~()]/g;

export function cloneObject(obj: ReplicaObject): ReplicaObject {
  return {
    ...obj,
    properties: { ...obj.properties },
    resolvedWith: [...obj.resolvedWith],
    aclPrincipals: [...obj.aclPrincipals],
    version: { ...obj.version },
  };
}

export function cloneLinkSet(ls: ReplicaLinkSet): ReplicaLinkSet {
  return {
    ...ls,
    links: ls.links.map((l) => ({ ...l })),
    version: { ...ls.version },
  };
}

export function determineTitleSubType(localTitle: string, peerTitle: string): TitleSubType {
  if (localTitle.toLowerCase() === peerTitle.toLowerCase()) return 'caseDifference';
  const localClean = localTitle.replace(PUNCT, '');
  const peerClean = peerTitle.replace(PUNCT, '');
  if (localClean === peerClean) return 'punctuationDifference';
  if (localClean.toLowerCase() === peerClean.toLowerCase()) return 'punctuationAndCaseDifference';
  return 'dissimilarTitles';
}

function detectGeotimeSubType(localObj: ReplicaObject, peerObj: ReplicaObject): GeotimeSubType | null {
  const localKeys = GEOTIME_PROPERTY_KEYS.filter((p) => p in localObj.properties);
  const peerKeys = GEOTIME_PROPERTY_KEYS.filter((p) => p in peerObj.properties);
  const localTz = localObj.properties['timeZone'];
  const peerTz = peerObj.properties['timeZone'];
  if (localTz !== undefined && peerTz !== undefined && localTz !== peerTz) {
    return 'timeZoneDifferenceOffset';
  }

  let hasDiff = false;
  let subType: GeotimeSubType = 'dissimilarGeotime';

  if (localKeys.length !== peerKeys.length) {
    hasDiff = true;
    subType = localKeys.length > peerKeys.length ? 'oursMultipleProperties' : 'theirsMultipleProperties';
  } else {
    for (const prop of GEOTIME_PROPERTY_KEYS) {
      if (localObj.properties[prop] !== peerObj.properties[prop]) {
        hasDiff = true;
        if (prop === 'location' || prop === 'latitude' || prop === 'longitude') {
          subType = 'geographicLocationDifference';
        } else if (prop === 'elevation') {
          subType = 'elevationDataDifference';
        } else if (prop === 'startDate' || prop === 'endDate') {
          subType = 'timeIntervalConflict';
        } else {
          subType = 'dissimilarGeotime';
        }
        break;
      }
    }
  }

  if (!hasDiff) return null;
  if (localKeys.length > 1 && peerKeys.length > 1) return 'bothMultipleProperties';
  return subType;
}

export interface DetectConflictOptions {
  nextId: (prefix: string) => string;
  now: string;
  localDeploymentName: string;
  peerDeploymentName: string;
  localVersion: VersionVector;
  incomingVersion: VersionVector;
}

export function detectObjectConflicts(
  localObj: ReplicaObject,
  peerObj: ReplicaObject,
  opts: DetectConflictOptions,
): AmbiguousDataConflict[] {
  const conflicts: AmbiguousDataConflict[] = [];
  const base = {
    objectId: localObj.id,
    localObject: cloneObject(localObj),
    peerObject: cloneObject(peerObj),
    localVersion: { ...opts.localVersion },
    incomingVersion: { ...opts.incomingVersion },
    localDeploymentName: opts.localDeploymentName,
    peerDeploymentName: opts.peerDeploymentName,
    resolved: false,
    detectedAt: opts.now,
  };

  if (localObj.objectType !== peerObj.objectType) {
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'objectType',
      description: `Object type conflict: local="${localObj.objectType}", peer="${peerObj.objectType}"`,
    });
  }
  if (localObj.title !== peerObj.title) {
    const subType = determineTitleSubType(localObj.title, peerObj.title);
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'title',
      subType,
      description: `Title conflict: local="${localObj.title}", peer="${peerObj.title}"`,
    });
  }
  if ((localObj.photo ?? '') !== (peerObj.photo ?? '')) {
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'photo',
      description: 'Photo conflict: local photo differs from peer photo',
    });
  }
  if ((localObj.deleted ?? false) !== (peerObj.deleted ?? false)) {
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'deletion',
      description: localObj.deleted
        ? 'Object deleted locally but modified at peer'
        : 'Object modified locally but deleted at peer',
    });
  }
  const geotime = detectGeotimeSubType(localObj, peerObj);
  if (geotime) {
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'geotime',
      subType: geotime,
      description: `Geotime conflict: ${geotime}`,
    });
  }
  const localResolved = localObj.resolvedWith;
  const peerResolved = peerObj.resolvedWith;
  const sameResolved =
    localResolved.length === peerResolved.length && localResolved.every((id) => peerResolved.includes(id));
  if (!sameResolved) {
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'resolution',
      description: `Resolution conflict: local resolved with ${localResolved.length} objects, peer with ${peerResolved.length}`,
    });
  }

  if (conflicts.length === 0) {
    conflicts.push({
      ...base,
      id: opts.nextId('conflict'),
      type: 'objectType',
      description: `Concurrent changes on object ${localObj.id}`,
    });
  }
  return conflicts;
}

export function detectLinkSetConflict(
  localLs: ReplicaLinkSet,
  peerLs: ReplicaLinkSet,
  opts: DetectConflictOptions,
): AmbiguousDataConflict {
  return {
    id: opts.nextId('conflict'),
    type: 'resolution',
    linkSetId: localLs.id,
    localLinkSet: cloneLinkSet(localLs),
    peerLinkSet: cloneLinkSet(peerLs),
    localVersion: { ...opts.localVersion },
    incomingVersion: { ...opts.incomingVersion },
    localDeploymentName: opts.localDeploymentName,
    peerDeploymentName: opts.peerDeploymentName,
    description: `Concurrent changes on link set ${localLs.id}`,
    resolved: false,
    detectedAt: opts.now,
  };
}

export function displayNameForSubType(subType: string): string {
  return TITLE_DISPLAY[subType] ?? subType;
}

export function groupBySubType(
  conflicts: readonly AmbiguousDataConflict[],
  type?: DataConflictType,
): ConflictGroup[] {
  const pending = conflicts.filter((c) => !c.resolved && (type === undefined || c.type === type));
  const groups = new Map<string, AmbiguousDataConflict[]>();
  for (const conflict of pending) {
    const key = conflict.subType ?? 'uncategorized';
    const list = groups.get(key) ?? [];
    list.push(conflict);
    groups.set(key, list);
  }
  const result: ConflictGroup[] = [];
  for (const [subType, items] of groups) {
    result.push({
      subType,
      conflicts: items,
      count: items.length,
      displayName: displayNameForSubType(subType),
    });
  }
  return result;
}

export function conflictStatistics(
  conflicts: readonly AmbiguousDataConflict[],
): Record<DataConflictType, number> {
  const stats: Record<DataConflictType, number> = {
    objectType: 0,
    title: 0,
    photo: 0,
    deletion: 0,
    geotime: 0,
    resolution: 0,
  };
  for (const c of conflicts) {
    if (!c.resolved) stats[c.type] += 1;
  }
  return stats;
}

export function filterView(
  conflicts: readonly AmbiguousDataConflict[],
  selectedType?: DataConflictType,
): ConflictFilterView {
  const pending = conflicts.filter((c) => !c.resolved);
  return {
    totalCount: pending.length,
    selectedType,
    availableTypes: [...DATA_CONFLICT_TYPES],
    typeCounts: conflictStatistics(conflicts),
    groupedConflicts: groupBySubType(conflicts, selectedType),
  };
}

export function resolutionView(conflicts: readonly AmbiguousDataConflict[]): ConflictResolutionView {
  const pending = conflicts.filter((c) => !c.resolved);
  const hasResolution = pending.some((c) => c.type === 'resolution');
  return {
    conflicts: pending,
    resolutionOptions: {
      acceptLocal: true,
      acceptPeer: true,
      merge: true,
      resolveAll: hasResolution,
      unresolveAll: hasResolution,
    },
  };
}

export function mergeObjects(local: ReplicaObject, peer: ReplicaObject): ReplicaObject {
  const merged = cloneObject(local);
  merged.objectType = peer.objectType || merged.objectType;
  if (peer.title) merged.title = peer.title;
  if (peer.photo !== undefined) merged.photo = peer.photo;
  merged.deleted = peer.deleted ?? merged.deleted;
  merged.properties = { ...local.properties, ...peer.properties };
  const resolved = new Set([...local.resolvedWith, ...peer.resolvedWith]);
  merged.resolvedWith = [...resolved];
  const principals = new Set([...local.aclPrincipals, ...peer.aclPrincipals]);
  merged.aclPrincipals = [...principals];
  return merged;
}

export function mergeLinkSets(local: ReplicaLinkSet, peer: ReplicaLinkSet): ReplicaLinkSet {
  const merged = cloneLinkSet(local);
  const ids = new Set(merged.links.map((l) => l.id));
  for (const link of peer.links) {
    if (!ids.has(link.id)) {
      merged.links.push({ ...link });
      ids.add(link.id);
    }
  }
  return merged;
}

export function applyObjectResolution(
  local: ReplicaObject,
  peer: ReplicaObject,
  resolution: ConflictResolution,
): ReplicaObject {
  switch (resolution.action) {
    case 'acceptLocal':
      return cloneObject(local);
    case 'acceptPeer':
      return cloneObject(peer);
    case 'merge':
      return mergeObjects(local, peer);
    case 'resolveAll': {
      const out = cloneObject(local);
      out.resolvedWith = [...new Set([...local.resolvedWith, ...peer.resolvedWith, peer.id])];
      return out;
    }
    case 'unresolveAll': {
      const out = cloneObject(local);
      out.resolvedWith = [];
      return out;
    }
  }
}
