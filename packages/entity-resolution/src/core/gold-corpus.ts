/**
 * entity-resolution — src/core/gold-corpus.ts
 * 50 pares rotulados MATCH/NO_MATCH (Passo 22 / tasks 068–070).
 * Corpus sintético, determinístico, sem domínio vertical.
 */

import { GOLD_SET_TARGET_SIZE, type EntityRecord, type GoldLabel } from 'contracts';

export interface GoldCorpusLabel {
  leftId: string;
  rightId: string;
  label: GoldLabel;
}

export interface GoldCorpus {
  records: EntityRecord[];
  labels: GoldCorpusLabel[];
}

function cnpj(n: number): string {
  const d = String(n).padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function rec(
  id: string,
  sourceSystem: string,
  properties: Record<string, unknown>,
): EntityRecord {
  return { id, objectTypeId: 'ot.customer', sourceSystem, properties };
}

/**
 * 25 MATCH + 25 NO_MATCH = 50.
 * MATCH fácil: mesmo documento, nome com variação de caixa/pontuação.
 * MATCH cinza: só nome (Empresa Silva vs Emp Silva) — zona de review.
 * NO_MATCH fácil: prefixo compartilhado, documentos distintos.
 * NO_MATCH cinza: nomes 3-tokens parecidos, entidades diferentes.
 */
export function buildPasso22GoldCorpus(): GoldCorpus {
  const records: EntityRecord[] = [];
  const labels: GoldCorpusLabel[] = [];

  for (let i = 0; i < 20; i++) {
    const doc = 11_222_333_000_100 + i;
    const a = rec(`m${i}a`, 'crm-a', {
      name: `Firma${i} LTDA`,
      document: cnpj(doc),
      city: 'São Paulo',
    });
    const b = rec(`m${i}b`, 'crm-b', {
      name: `Firma${i} Ltda.`,
      document: String(doc),
      city: 'Sao Paulo',
    });
    records.push(a, b);
    labels.push({ leftId: a.id, rightId: b.id, label: 'MATCH' });
  }

  for (let i = 0; i < 5; i++) {
    const a = rec(`g${i}a`, 'crm-a', {
      name: `Nova${i} Empresa Silva`,
      city: 'Campinas',
    });
    const b = rec(`g${i}b`, 'crm-b', {
      name: `Nova${i} Emp Silva`,
      city: 'Campinas',
    });
    records.push(a, b);
    labels.push({ leftId: a.id, rightId: b.id, label: 'MATCH' });
  }

  for (let i = 0; i < 20; i++) {
    const a = rec(`n${i}a`, 'crm-a', {
      name: `Pair${i} Alpha`,
      document: cnpj(22_000_000_000_100 + i),
      city: 'Recife',
    });
    const b = rec(`n${i}b`, 'crm-b', {
      name: `Pair${i} Beta`,
      document: cnpj(33_000_000_000_100 + i),
      city: 'Manaus',
    });
    records.push(a, b);
    labels.push({ leftId: a.id, rightId: b.id, label: 'NO_MATCH' });
  }

  for (let i = 0; i < 5; i++) {
    const a = rec(`x${i}a`, 'crm-a', {
      name: `Alpha${i} Comercio Norte`,
      city: 'Curitiba',
    });
    const b = rec(`x${i}b`, 'crm-b', {
      name: `Alpha${i} Comercio Sul`,
      city: 'Curitiba',
    });
    records.push(a, b);
    labels.push({ leftId: a.id, rightId: b.id, label: 'NO_MATCH' });
  }

  if (labels.length !== GOLD_SET_TARGET_SIZE) {
    throw new Error(`gold corpus deve ter ${GOLD_SET_TARGET_SIZE} pares, tem ${labels.length}`);
  }
  return { records, labels };
}
