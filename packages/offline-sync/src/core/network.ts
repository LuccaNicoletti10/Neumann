/**
 * offline-sync — src/core/network.ts
 * Simulador: partition, reorder, duplicate, drop, 3+ réplicas.
 */

import { objectVisibleTo, type PrincipalId, type ReplicaUpdate } from 'contracts';

import type { ApplyResult, Replica } from './replica.js';

export interface DeliveryOptions {
  dropIds?: readonly string[];
  duplicate?: boolean;
  reverse?: boolean;
  /** Só entrega updates de objetos visíveis a este principal (snapshot autorizado). */
  principal?: PrincipalId;
}

export interface Network {
  attach(replica: Replica): void;
  partition(a: string, b: string): void;
  heal(a: string, b: string): void;
  healAll(): void;
  isPartitioned(a: string, b: string): boolean;
  replica(id: string): Replica;
  ids(): string[];
  deliver(fromId: string, toId: string, opts?: DeliveryOptions): ApplyResult[];
  stabilize(opts?: DeliveryOptions & { rounds?: number }): void;
  /** Hub↔hub irrestrito; hub→laptop só snapshot autorizado. */
  stabilizeAuthorized(laptopId: string, principal: PrincipalId, rounds?: number): void;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function visibleUpdate(update: ReplicaUpdate, principal: PrincipalId): boolean {
  if (update.object) return objectVisibleTo(update.object, principal);
  if (update.linkSet) return true;
  return true;
}

export function createNetwork(replicas: Replica[]): Network {
  const byId = new Map(replicas.map((r) => [r.id, r]));
  const partitions = new Set<string>();

  function get(id: string): Replica {
    const r = byId.get(id);
    if (!r) throw new Error(`replica ${id} not found`);
    return r;
  }

  const net: Network = {
    attach(replica) {
      byId.set(replica.id, replica);
    },
    partition(a, b) {
      partitions.add(pairKey(a, b));
    },
    heal(a, b) {
      partitions.delete(pairKey(a, b));
    },
    healAll() {
      partitions.clear();
    },
    isPartitioned(a, b) {
      return partitions.has(pairKey(a, b));
    },
    replica(id) {
      return get(id);
    },
    ids() {
      return [...byId.keys()];
    },
    deliver(fromId, toId, opts = {}) {
      if (fromId === toId) return [];
      if (net.isPartitioned(fromId, toId)) return [];
      const from = get(fromId);
      const to = get(toId);
      let batch = from.log().filter((u) => !to.hasApplied(u.id));
      if (opts.principal) {
        batch = batch.filter((u) => visibleUpdate(u, opts.principal!));
      }
      if (opts.dropIds && opts.dropIds.length > 0) {
        const drop = new Set(opts.dropIds);
        batch = batch.filter((u) => !drop.has(u.id));
      }
      if (opts.reverse) batch = [...batch].reverse();
      const toApply = opts.duplicate ? [...batch, ...batch] : batch;
      return toApply.map((u) => to.apply(u));
    },
    stabilize(opts = {}) {
      const rounds = opts.rounds ?? 8;
      const ids = [...byId.keys()];
      for (let i = 0; i < rounds; i += 1) {
        for (const fromId of ids) {
          for (const toId of ids) {
            net.deliver(fromId, toId, opts);
          }
        }
      }
    },
    stabilizeAuthorized(laptopId, principal, rounds = 8) {
      const ids = [...byId.keys()];
      for (let i = 0; i < rounds; i += 1) {
        for (const fromId of ids) {
          for (const toId of ids) {
            const opts: DeliveryOptions = toId === laptopId ? { principal } : {};
            net.deliver(fromId, toId, opts);
          }
        }
      }
    },
  };

  return net;
}
