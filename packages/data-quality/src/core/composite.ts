/**
 * data-quality — src/core/composite.ts
 * Datasets compostos via joins multi-input (US 9,542,446 / 10,678,860).
 */

import type { CompositeDatasetDef } from 'contracts';

import type { NamedDataset, Row } from './types.js';

export function materializeComposite(
  def: CompositeDatasetDef,
  sources: Map<string, NamedDataset>,
  now: string,
): NamedDataset {
  if (def.sourceDatasetIds.length === 0) {
    throw new Error('composite sem sources');
  }

  let current = cloneDataset(requireSource(sources, def.sourceDatasetIds[0]!), now);

  for (const join of def.joinKeys) {
    const left = current.id === join.leftDatasetId ? current : requireSource(sources, join.leftDatasetId);
    const right = requireSource(sources, join.rightDatasetId);
    // Se current não é left, assume current já é o acumulado e leftColumn existe nele
    const leftRows = current.rows;
    const rightRows = right.rows;
    const joined: Row[] = [];
    for (const l of leftRows) {
      for (const r of rightRows) {
        if (String(l[join.leftColumn]) === String(r[join.rightColumn])) {
          joined.push({ ...l, ...prefixKeys(r, right.name) });
        }
      }
    }
    const columns = [
      ...new Set([
        ...current.columns,
        ...right.columns.map((c) => `${right.name}.${c}`),
      ]),
    ];
    current = {
      id: def.id,
      name: def.name,
      version: 1,
      columns,
      rows: joined,
      updatedAt: now,
    };
    void left;
  }

  // Se não houve joinKeys, concat horizontal só do primeiro (já current)
  if (def.joinKeys.length === 0 && def.sourceDatasetIds.length > 1) {
    throw new Error('composite multi-source exige joinKeys');
  }

  current.id = def.id;
  current.name = def.name;
  return current;
}

function requireSource(sources: Map<string, NamedDataset>, id: string): NamedDataset {
  const s = sources.get(id);
  if (!s) throw new Error(`source inexistente: ${id}`);
  return s;
}

function cloneDataset(ds: NamedDataset, now: string): NamedDataset {
  return {
    id: ds.id,
    name: ds.name,
    version: ds.version,
    columns: [...ds.columns],
    rows: ds.rows.map((r) => ({ ...r })),
    updatedAt: now,
    previousDistribution: ds.previousDistribution
      ? { ...ds.previousDistribution }
      : undefined,
  };
}

function prefixKeys(row: Row, prefix: string): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[`${prefix}.${k}`] = v;
  }
  return out;
}
