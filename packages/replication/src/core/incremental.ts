/**
 * replication — src/core/incremental.ts
 * US 8,886,601 / US 9,785,694 — plano persistente + chunks por object id.
 */

import type { ReplicationChunk, ReplicationChunkSpec, ReplicationPlan } from 'contracts';

import type { IdGenerator } from './determinism.js';
import { createIdGenerator } from './determinism.js';
import type { PeerPolicy, ReplicationSite as Site } from './site.js';

export interface ExportingSystem {
  plan(peerId: string, opts?: { chunkSize?: number; numChunks?: number }): ReplicationPlan;
  execute(planId: string, policy: PeerPolicy): ReplicationChunk[];
  getPlan(planId: string): ReplicationPlan | undefined;
}

export interface ImportingSystem {
  receiveChunk(chunk: ReplicationChunk): { applied: number; duplicate: boolean };
}

function chunkRanges(ids: string[], n: number): ReplicationChunkSpec[] {
  const sorted = [...ids].sort();
  if (sorted.length === 0 || n <= 1) {
    return [
      {
        chunkId: 1,
        objectIdMin: sorted[0] ?? '',
        objectIdMax: sorted[sorted.length - 1] ?? '',
        complete: false,
      },
    ];
  }
  const specs: ReplicationChunkSpec[] = [];
  const per = Math.max(1, Math.floor(sorted.length / n));
  for (let i = 0; i < n; i += 1) {
    const start = i * per;
    const end = i === n - 1 ? sorted.length : Math.min((i + 1) * per, sorted.length);
    if (start >= sorted.length) {
      specs.push({ chunkId: i + 1, objectIdMin: '', objectIdMax: '', complete: false });
      continue;
    }
    const min = sorted[start] ?? '';
    const max = sorted[Math.max(start, end - 1)] ?? min;
    specs.push({ chunkId: i + 1, objectIdMin: min, objectIdMax: max, complete: false });
  }
  return specs;
}

export function createExportingSystem(site: Site, nextId: IdGenerator = createIdGenerator()): ExportingSystem {
  const plans = new Map<string, ReplicationPlan>();

  return {
    plan(peerId, opts = {}) {
      const ids = site.objects().map((o) => o.id);
      let n = 1;
      if (opts.numChunks && opts.numChunks > 0) n = opts.numChunks;
      else if (opts.chunkSize && opts.chunkSize > 0) n = Math.max(1, Math.ceil(ids.length / opts.chunkSize));
      const plan: ReplicationPlan = {
        planId: nextId('plan'),
        snapshotClock: site.logicalClock(),
        peerId,
        chunks: chunkRanges(ids, n),
      };
      plans.set(plan.planId, plan);
      return plan;
    },

    execute(planId, policy) {
      const plan = plans.get(planId);
      if (!plan) throw new Error(`plan ${planId} not found`);
      const all = site.exportForPeer(plan.peerId, policy).filter((m) => m.logicalClock <= plan.snapshotClock);
      const chunks: ReplicationChunk[] = [];
      for (const spec of plan.chunks) {
        if (spec.complete) continue;
        const mutations = all.filter((m) => {
          if (!spec.objectIdMin && !spec.objectIdMax) return true;
          return m.objectId >= spec.objectIdMin && m.objectId <= spec.objectIdMax;
        });
        chunks.push({
          planId: plan.planId,
          chunkId: spec.chunkId,
          snapshotClock: plan.snapshotClock,
          mutations,
        });
        spec.complete = true;
      }
      return chunks;
    },

    getPlan(planId) {
      return plans.get(planId);
    },
  };
}

export function createImportingSystem(site: Site): ImportingSystem {
  const seen = new Set<string>();
  return {
    receiveChunk(chunk) {
      const key = `${chunk.planId}:${chunk.chunkId}`;
      if (seen.has(key)) return { applied: 0, duplicate: true };
      let applied = 0;
      for (const m of chunk.mutations) {
        const r = site.apply(m);
        if (r.status === 'applied' || r.status === 'conflict') applied += 1;
      }
      seen.add(key);
      return { applied, duplicate: false };
    },
  };
}

export type { ReplicationChunk, ReplicationPlan };
