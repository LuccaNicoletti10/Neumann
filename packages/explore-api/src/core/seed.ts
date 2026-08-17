/**
 * explore-api — src/core/seed.ts
 * Dataset de vendas (domínio-neutro) para o gate do Passo 30.
 */

import type { LinkRecord, ObjectRecord } from 'contracts';

import type { ExploreCatalog } from './catalog.js';

export const EXPLORE_SECRET = 'LEAK-INTERNAL-NOTE';

function rec(
  id: string,
  objectTypeId: string,
  primaryKey: string,
  properties: Record<string, unknown>,
  at = '2024-06-01T12:00:00.000Z',
): ObjectRecord {
  return {
    id,
    ontologyId: 'ont-sales',
    objectTypeId,
    primaryKey,
    properties,
    version: 1,
    deleted: false,
    createdAt: at,
    updatedAt: at,
  };
}

export function seedExploreCatalog(): ExploreCatalog {
  const objects: ObjectRecord[] = [
    rec('obj-c1', 'ot.customer', 'C1', { name: 'Acme', status: 'active', region: 'south' }),
    rec('obj-c2', 'ot.customer', 'C2', { name: 'Beta', status: 'active', region: 'north' }),
    rec(
      'obj-so1',
      'ot.sales_order',
      'SO-1',
      { status: 'open', amount: 1200, internal: EXPLORE_SECRET },
      '2024-06-01T12:00:10.000Z',
    ),
    rec(
      'obj-so2',
      'ot.sales_order',
      'SO-2',
      { status: 'closed', amount: 400 },
      '2024-06-01T12:00:20.000Z',
    ),
    rec('obj-n1', 'ot.internal_note', 'N1', { body: EXPLORE_SECRET, topic: 'watchlist' }),
  ];
  const links: LinkRecord[] = [
    {
      id: 'lnk-1',
      ontologyId: 'ont-sales',
      linkTypeId: 'lt.placed',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C1',
      targetObjectTypeId: 'ot.sales_order',
      targetPrimaryKey: 'SO-1',
      createdAt: '2024-06-01T12:00:00.000Z',
    },
    {
      id: 'lnk-2',
      ontologyId: 'ont-sales',
      linkTypeId: 'lt.placed',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C2',
      targetObjectTypeId: 'ot.sales_order',
      targetPrimaryKey: 'SO-2',
      createdAt: '2024-06-01T12:00:00.000Z',
    },
    {
      id: 'lnk-3',
      ontologyId: 'ont-sales',
      linkTypeId: 'lt.noted',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C1',
      targetObjectTypeId: 'ot.internal_note',
      targetPrimaryKey: 'N1',
      createdAt: '2024-06-01T12:00:00.000Z',
    },
  ];
  return { objects, links };
}
