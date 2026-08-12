/**
 * entity-resolution — src/core/cluster.ts
 * Soft resolution: agrupa matches em clusters sem destruir originais (US 12,229,154).
 */

import type { CandidatePair, ClusterId, EntityRecordId, SoftCluster } from 'contracts';

import type { IdGenerator } from './types.js';

/** Union-Find para componentes conexos dos MATCH. */
export function buildSoftClusters(
  recordIds: EntityRecordId[],
  objectTypeById: Map<EntityRecordId, string>,
  displayNameById: Map<EntityRecordId, string | undefined>,
  candidates: CandidatePair[],
  nextId: IdGenerator,
): SoftCluster[] {
  const parent = new Map<EntityRecordId, EntityRecordId>();
  for (const id of recordIds) parent.set(id, id);

  function find(x: EntityRecordId): EntityRecordId {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) {
      const gp = parent.get(p) ?? p;
      parent.set(p, gp);
      p = gp;
    }
    return p;
  }

  function union(a: EntityRecordId, b: EntityRecordId): void {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Representante estável: menor id lexicográfico
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  }

  for (const c of candidates) {
    if (c.decision !== 'match') continue;
    union(c.leftId, c.rightId);
  }

  const groups = new Map<EntityRecordId, EntityRecordId[]>();
  for (const id of recordIds) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }

  const clusters: SoftCluster[] = [];
  for (const [root, members] of groups) {
    members.sort();
    const objectTypeId = objectTypeById.get(root) ?? 'ot.unknown';
    const displayName =
      displayNameById.get(root) ??
      members.map((m) => displayNameById.get(m)).find((n) => n);
    clusters.push({
      clusterId: nextId('cluster') as ClusterId,
      objectTypeId,
      memberIds: members,
      suggestedCanonicalId: root,
      displayName,
    });
  }

  // Ordena: clusters maiores primeiro, depois por canonical id
  clusters.sort((a, b) => {
    if (b.memberIds.length !== a.memberIds.length) {
      return b.memberIds.length - a.memberIds.length;
    }
    return a.suggestedCanonicalId.localeCompare(b.suggestedCanonicalId);
  });

  return clusters;
}
