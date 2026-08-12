/**
 * entity-resolution — src/core/blocking.ts
 * Blocking por slug/bin (US20140280252) + multimap de chaves exatas.
 * Prova T3.6: comparações só dentro do bloco.
 */

import { createHash } from 'node:crypto';

import type { BlockKey, NormalizedRecord } from 'contracts';

export interface BlockIndex {
  /** blockKey → recordIds */
  byKey: Map<BlockKey, string[]>;
  /** bloom bin → recordIds (pré-filtro probabilístico) */
  byBin: Map<number, string[]>;
  numBins: number;
  /** Pares únicos (idA|idB ordenado) gerados pelo blocking. */
  candidatePairKeys: Set<string>;
}

export function bloomBin(slug: string, numBins: number): number {
  const h = createHash('md5').update(slug).digest();
  const n = h.readUInt32BE(0);
  return n % Math.max(1, numBins);
}

export function optimalBins(corpusSize: number): number {
  // Heurística da patente: mais bins → menor colisão; mínimo 16
  return Math.max(16, corpusSize * 10);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Constrói índice de blocos e enumera pares candidatos.
 * Nunca gera o produto cartesiano completo.
 */
export function buildBlockIndex(
  records: NormalizedRecord[],
  numBins?: number,
): BlockIndex {
  const bins = numBins ?? optimalBins(records.length);
  const byKey = new Map<BlockKey, string[]>();
  const byBin = new Map<number, string[]>();
  const byId = new Map<string, NormalizedRecord>();

  for (const r of records) {
    byId.set(r.recordId, r);
    const bin = bloomBin(r.slug, bins);
    const binList = byBin.get(bin) ?? [];
    binList.push(r.recordId);
    byBin.set(bin, binList);

    for (const k of r.blockKeys) {
      const list = byKey.get(k) ?? [];
      list.push(r.recordId);
      byKey.set(k, list);
    }
  }

  const candidatePairKeys = new Set<string>();

  // Multimap por chave exata/nome — fonte principal de candidatos
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const ra = byId.get(a)!;
        const rb = byId.get(b)!;
        // Tipos incompatíveis → sem candidato (US20140280252)
        if (ra.objectTypeId !== rb.objectTypeId) continue;
        candidatePairKeys.add(pairKey(a, b));
      }
    }
  }

  return { byKey, byBin, numBins: bins, candidatePairKeys };
}

export function enumerateCandidatePairs(
  records: NormalizedRecord[],
  index: BlockIndex,
): Array<[NormalizedRecord, NormalizedRecord, BlockKey]> {
  const byId = new Map(records.map((r) => [r.recordId, r]));
  const out: Array<[NormalizedRecord, NormalizedRecord, BlockKey]> = [];
  const seen = new Set<string>();

  for (const [key, ids] of index.byKey) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const pk = pairKey(a, b);
        if (seen.has(pk)) continue;
        const ra = byId.get(a);
        const rb = byId.get(b);
        if (!ra || !rb) continue;
        if (ra.objectTypeId !== rb.objectTypeId) continue;
        seen.add(pk);
        out.push([ra, rb, key]);
      }
    }
  }

  return out;
}

export function fullCartesianCount(n: number): number {
  if (n < 2) return 0;
  return (n * (n - 1)) / 2;
}
