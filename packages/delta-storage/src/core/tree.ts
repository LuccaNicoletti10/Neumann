/**
 * delta-storage — src/core/tree.ts
 * BASE + Δ individuais + Combined hierárquicos (US 11,397,717).
 */

import type {
  BaseSnapshot,
  CombinedDelta,
  DeltaOp,
  IndividualDelta,
  MinimalDeltaSet,
} from 'contracts';

import { applyOps, deepClone, diffStates } from './apply.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { canonicalBytes, canonicalizeJson, hashCanonical } from './hash.js';
import { DeltaCorruptError, type Clock, type DeltaTreeOptions, type IdGenerator } from './types.js';
import { createZeroCopyCache, type ZeroCopyCache } from './zero-copy.js';

export interface DataItemRecord {
  id: string;
  name: string;
  base: BaseSnapshot;
  individuals: Map<number, IndividualDelta>;
  combined: CombinedDelta[];
  /** Estado materializado atual (após último append). */
  head: unknown;
  headUpdate: number;
}

export interface ReconstructResult {
  state: unknown;
  bytes: Buffer;
  checksum: string;
  usedCombined: number;
  usedIndividuals: number;
  skippedCorrupt: string[];
}

export interface DeltaTree {
  readonly cache: ZeroCopyCache;
  createItem(name: string, basePayload: unknown): DataItemRecord;
  getItem(id: string): DataItemRecord | undefined;
  getItemByName(name: string): DataItemRecord | undefined;
  /** Append estado novo → gera Δ individual; compacta se atingir fronteiras. */
  appendState(dataItemId: string, nextState: unknown): IndividualDelta;
  /** Append ops explícitas. */
  appendOps(dataItemId: string, ops: DeltaOp[]): IndividualDelta;
  /** Gera combined em fronteiras (não reescreve individuais). */
  compact(dataItemId: string): CombinedDelta[];
  listIndividuals(dataItemId: string): IndividualDelta[];
  listCombined(dataItemId: string): CombinedDelta[];
  determineMinimalSet(dataItemId: string, targetUpdate: number): MinimalDeltaSet;
  /** Reconstrução eficiente (combined + restantes). */
  reconstruct(dataItemId: string, targetUpdate: number): ReconstructResult;
  /** Replay linear só com individuais (oráculo do gate). */
  reconstructLinear(dataItemId: string, targetUpdate: number): ReconstructResult;
  /** Injeta delta corrompido (testes). */
  corruptIndividual(dataItemId: string, updateNumber: number): void;
  verifyChecksum(delta: IndividualDelta | CombinedDelta): boolean;
}

function widthForLevel(fanout: number, level: number): number {
  return fanout ** level;
}

export function createDeltaTree(opts: DeltaTreeOptions = {}): DeltaTree {
  const fanout = opts.fanout ?? 10;
  const maxLevel = opts.maxLevel ?? 3;
  const clock: Clock = opts.clock ?? createDeterministicClock();
  const nextId: IdGenerator = opts.nextId ?? createIdGenerator();
  const cache = createZeroCopyCache();
  const items = new Map<string, DataItemRecord>();

  function requireItem(id: string): DataItemRecord {
    const item = items.get(id);
    if (!item) throw new Error(`data item inexistente: ${id}`);
    return item;
  }

  function storePayloadBytes(payload: unknown): { checksum: string; bytes: Buffer } {
    const bytes = canonicalBytes(payload);
    const put = cache.put(bytes);
    return { checksum: put.hash, bytes: put.bytes };
  }

  function makeIndividual(
    dataItemId: string,
    updateNumber: number,
    ops: DeltaOp[],
  ): IndividualDelta {
    const checksum = hashCanonical(ops);
    const createdAt = clock();
    const delta: IndividualDelta = {
      id: nextId('d'),
      updateNumber,
      dataItemId,
      ops: deepClone(ops),
      checksum,
      createdAt,
      kind: 'delta',
    };
    // zero-copy: cache bytes do delta
    cache.put(Buffer.from(canonicalizeJson(ops), 'utf8'));
    return delta;
  }

  function makeCombined(
    item: DataItemRecord,
    level: number,
    startUpdate: number,
    endUpdate: number,
  ): CombinedDelta {
    // Estado imediatamente antes de startUpdate
    const before =
      startUpdate <= 1
        ? deepClone(item.base.payload)
        : reconstructLinearInternal(item, startUpdate - 1).state;
    const after = reconstructLinearInternal(item, endUpdate).state;
    const ops = diffStates(before, after);
    const childrenIds: string[] = [];
    if (level === 1) {
      for (let n = startUpdate; n <= endUpdate; n++) {
        const d = item.individuals.get(n);
        if (d) childrenIds.push(d.id);
      }
    } else {
      for (const c of item.combined) {
        if (
          c.level === level - 1 &&
          c.startUpdate >= startUpdate &&
          c.endUpdate <= endUpdate
        ) {
          childrenIds.push(c.id);
        }
      }
    }
    const combined: CombinedDelta = {
      id: nextId('cd'),
      level,
      startUpdate,
      endUpdate,
      width: endUpdate - startUpdate + 1,
      dataItemId: item.id,
      ops: deepClone(ops),
      checksum: hashCanonical(ops),
      createdAt: clock(),
      kind: 'combined',
      childrenIds,
    };
    cache.put(Buffer.from(canonicalizeJson(ops), 'utf8'));
    return combined;
  }

  function hasCombined(
    item: DataItemRecord,
    level: number,
    start: number,
    end: number,
  ): boolean {
    return item.combined.some(
      (c) => c.level === level && c.startUpdate === start && c.endUpdate === end,
    );
  }

  function compactItem(item: DataItemRecord): CombinedDelta[] {
    const created: CombinedDelta[] = [];
    const total = item.headUpdate;
    if (total === 0) return created;

    for (let level = 1; level <= maxLevel; level++) {
      const w = widthForLevel(fanout, level);
      for (let start = 1; start <= total; start += w) {
        const end = Math.min(start + w - 1, total);
        // só grava combined completo (janela cheia) ou se end==total e width>=1 na última parcial?
        // Spec GUIA: Combined Δ1-10, Δ1-1000 — janelas completas; parciais no fim opcionais.
        // Geramos apenas janelas completas (end - start + 1 === w) para estabilidade.
        if (end - start + 1 !== w) continue;
        if (hasCombined(item, level, start, end)) continue;
        // nível >1 exige que filhos L-1 existam cobrindo o range
        if (level > 1) {
          const childW = widthForLevel(fanout, level - 1);
          let ok = true;
          for (let s = start; s <= end; s += childW) {
            const e = s + childW - 1;
            if (!hasCombined(item, level - 1, s, e)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        const c = makeCombined(item, level, start, end);
        item.combined.push(c);
        created.push(c);
      }
    }
    return created;
  }

  function verifyOpsChecksum(ops: DeltaOp[], checksum: string): boolean {
    return hashCanonical(ops) === checksum;
  }

  function reconstructLinearInternal(
    item: DataItemRecord,
    targetUpdate: number,
  ): ReconstructResult {
    let state = deepClone(item.base.payload);
    const skippedCorrupt: string[] = [];
    let used = 0;
    for (let n = 1; n <= targetUpdate; n++) {
      const d = item.individuals.get(n);
      if (!d) throw new Error(`delta ausente: ${n}`);
      if (!verifyOpsChecksum(d.ops, d.checksum)) {
        skippedCorrupt.push(d.id);
        throw new DeltaCorruptError(`delta individual corrompido: ${d.id}`, d.id);
      }
      state = applyOps(state, d.ops);
      used += 1;
    }
    const { checksum, bytes } = storePayloadBytes(state);
    return {
      state,
      bytes,
      checksum,
      usedCombined: 0,
      usedIndividuals: used,
      skippedCorrupt,
    };
  }

  function determineMinimalSetInternal(
    item: DataItemRecord,
    targetUpdate: number,
  ): MinimalDeltaSet {
    if (targetUpdate < 0) throw new Error('targetUpdate inválido');
    if (targetUpdate === 0) {
      return {
        baseId: item.base.id,
        combined: [],
        individuals: [],
        targetUpdate: 0,
      };
    }
    if (targetUpdate > item.headUpdate) {
      throw new Error(`targetUpdate ${targetUpdate} > head ${item.headUpdate}`);
    }

    const chosenCombined: CombinedDelta[] = [];
    const covered = new Set<number>();

    // Greedy: maiores níveis primeiro, maior width, depois start menor
    const candidates = [...item.combined]
      .filter((c) => c.endUpdate <= targetUpdate)
      .sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        if (b.width !== a.width) return b.width - a.width;
        return a.startUpdate - b.startUpdate;
      });

    for (const c of candidates) {
      if (!verifyOpsChecksum(c.ops, c.checksum)) continue; // skip corrupt combined
      let overlaps = false;
      for (let n = c.startUpdate; n <= c.endUpdate; n++) {
        if (covered.has(n)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      // só aceita se cobre um gap contínuo ainda não coberto
      chosenCombined.push(c);
      for (let n = c.startUpdate; n <= c.endUpdate; n++) covered.add(n);
    }

    const individuals: IndividualDelta[] = [];
    for (let n = 1; n <= targetUpdate; n++) {
      if (covered.has(n)) continue;
      const d = item.individuals.get(n);
      if (!d) throw new Error(`delta ausente: ${n}`);
      individuals.push(d);
    }

    // ordenar combined por start
    chosenCombined.sort((a, b) => a.startUpdate - b.startUpdate);
    individuals.sort((a, b) => a.updateNumber - b.updateNumber);

    return {
      baseId: item.base.id,
      combined: chosenCombined.map((c) => ({ ...c, ops: deepClone(c.ops), childrenIds: [...c.childrenIds] })),
      individuals: individuals.map((d) => ({ ...d, ops: deepClone(d.ops) })),
      targetUpdate,
    };
  }

  function reconstructFromSet(
    item: DataItemRecord,
    set: MinimalDeltaSet,
  ): ReconstructResult {
    let state = deepClone(item.base.payload);
    const skippedCorrupt: string[] = [];
    const events: Array<{ start: number; apply: () => void }> = [];

    for (const c of set.combined) {
      if (!verifyOpsChecksum(c.ops, c.checksum)) {
        skippedCorrupt.push(c.id);
        // contorna: expandir para indivíduos
        for (let n = c.startUpdate; n <= c.endUpdate; n++) {
          const d = item.individuals.get(n);
          if (!d) throw new Error(`delta ausente ao contornar combined: ${n}`);
          events.push({
            start: n,
            apply: () => {
              if (!verifyOpsChecksum(d.ops, d.checksum)) {
                throw new DeltaCorruptError(`delta individual corrompido: ${d.id}`, d.id);
              }
              state = applyOps(state, d.ops);
            },
          });
        }
        continue;
      }
      events.push({
        start: c.startUpdate,
        apply: () => {
          state = applyOps(state, c.ops);
        },
      });
    }

    for (const d of set.individuals) {
      events.push({
        start: d.updateNumber,
        apply: () => {
          if (!verifyOpsChecksum(d.ops, d.checksum)) {
            skippedCorrupt.push(d.id);
            throw new DeltaCorruptError(`delta individual corrompido: ${d.id}`, d.id);
          }
          state = applyOps(state, d.ops);
        },
      });
    }

    events.sort((a, b) => a.start - b.start);
    for (const e of events) e.apply();

    const { checksum, bytes } = storePayloadBytes(state);
    return {
      state,
      bytes,
      checksum,
      usedCombined: set.combined.length,
      usedIndividuals: set.individuals.length,
      skippedCorrupt,
    };
  }

  return {
    cache,

    createItem(name: string, basePayload: unknown): DataItemRecord {
      const id = nextId('item');
      const { checksum } = storePayloadBytes(basePayload);
      const base: BaseSnapshot = {
        id: nextId('base'),
        dataItemId: id,
        payload: deepClone(basePayload),
        checksum,
        createdAt: clock(),
        kind: 'full',
      };
      const record: DataItemRecord = {
        id,
        name,
        base,
        individuals: new Map(),
        combined: [],
        head: deepClone(basePayload),
        headUpdate: 0,
      };
      items.set(id, record);
      return record;
    },

    getItem(id: string): DataItemRecord | undefined {
      return items.get(id);
    },

    getItemByName(name: string): DataItemRecord | undefined {
      for (const item of items.values()) {
        if (item.name === name) return item;
      }
      return undefined;
    },

    appendOps(dataItemId: string, ops: DeltaOp[]): IndividualDelta {
      const item = requireItem(dataItemId);
      const next = applyOps(item.head, ops);
      const updateNumber = item.headUpdate + 1;
      const delta = makeIndividual(dataItemId, updateNumber, ops);
      item.individuals.set(updateNumber, delta);
      item.head = next;
      item.headUpdate = updateNumber;
      compactItem(item);
      return { ...delta, ops: deepClone(delta.ops) };
    },

    appendState(dataItemId: string, nextState: unknown): IndividualDelta {
      const item = requireItem(dataItemId);
      const ops = diffStates(item.head, nextState);
      return this.appendOps(dataItemId, ops);
    },

    compact(dataItemId: string): CombinedDelta[] {
      return compactItem(requireItem(dataItemId)).map((c) => ({
        ...c,
        ops: deepClone(c.ops),
        childrenIds: [...c.childrenIds],
      }));
    },

    listIndividuals(dataItemId: string): IndividualDelta[] {
      const item = requireItem(dataItemId);
      return [...item.individuals.values()]
        .sort((a, b) => a.updateNumber - b.updateNumber)
        .map((d) => ({ ...d, ops: deepClone(d.ops) }));
    },

    listCombined(dataItemId: string): CombinedDelta[] {
      const item = requireItem(dataItemId);
      return item.combined.map((c) => ({
        ...c,
        ops: deepClone(c.ops),
        childrenIds: [...c.childrenIds],
      }));
    },

    determineMinimalSet(dataItemId: string, targetUpdate: number): MinimalDeltaSet {
      return determineMinimalSetInternal(requireItem(dataItemId), targetUpdate);
    },

    reconstruct(dataItemId: string, targetUpdate: number): ReconstructResult {
      const item = requireItem(dataItemId);
      const set = determineMinimalSetInternal(item, targetUpdate);
      return reconstructFromSet(item, set);
    },

    reconstructLinear(dataItemId: string, targetUpdate: number): ReconstructResult {
      return reconstructLinearInternal(requireItem(dataItemId), targetUpdate);
    },

    corruptIndividual(dataItemId: string, updateNumber: number): void {
      const item = requireItem(dataItemId);
      const d = item.individuals.get(updateNumber);
      if (!d) throw new Error(`delta ausente: ${updateNumber}`);
      // corrompe ops sem atualizar checksum
      d.ops = [...d.ops, { type: 'update', path: '__corrupt__', value: true }];
    },

    verifyChecksum(delta: IndividualDelta | CombinedDelta): boolean {
      return verifyOpsChecksum(delta.ops, delta.checksum);
    },
  };
}
