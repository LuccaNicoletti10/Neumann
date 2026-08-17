/**
 * explore-api — tests/passo30.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenGraphPattern } from 'contracts';
import { createOntologyAuthorizer } from 'policy-engine';

import {
  bindSlot,
  createBindingStore,
  evaluateExpression,
  projectObject,
  suggestBindings,
} from '../src/core/bindings.js';
import { runDemo } from '../src/cli.js';
import { createIdGenerator } from '../src/core/determinism.js';
import {
  buildInvestigationIndex,
  singleLevelSearch,
  transformTokens,
  twoLevelSearch,
} from '../src/core/investigation.js';
import { executeGraphPattern } from '../src/core/pattern.js';
import { computeObjectScores } from '../src/core/scorer.js';
import { EXPLORE_SECRET, seedExploreCatalog } from '../src/core/seed.js';

function authz() {
  return createOntologyAuthorizer({
    roles: { alice: ['financeiro'], bob: ['ops'] },
    grants: [
      {
        role: 'financeiro',
        objectTypes: ['ot.customer', 'ot.sales_order', 'ot.internal_note'],
        operations: ['read', 'modify'],
      },
      {
        role: 'ops',
        objectTypes: ['ot.customer', 'ot.sales_order'],
        operations: ['read'],
        hiddenProperties: ['internal'],
      },
    ],
  });
}

describe('Passo 30 — exploração genérica', () => {
  it('CLI demo exit 0 e sem leak', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
    expect(lines.join('\n')).not.toContain(EXPLORE_SECRET);
  });

  it('GraphPattern: Bob não vê nota interna; Alice vê', () => {
    const catalog = seedExploreCatalog();
    const pattern = {
      rootNodeId: 'c',
      nodes: [
        { id: 'c', objectTypeId: 'ot.customer', primaryKey: 'C1' },
        { id: 'n', objectTypeId: 'ot.internal_note' },
      ],
      edges: [{ id: 'e', source: 'c', target: 'n', linkTypeId: 'lt.noted' }],
    };
    const alice = executeGraphPattern({ catalog, pattern, principal: 'alice', authorizer: authz() });
    const bob = executeGraphPattern({ catalog, pattern, principal: 'bob', authorizer: authz() });
    expect(alice.total).toBe(1);
    expect(bob.total).toBe(0);
    expect(JSON.stringify(bob)).not.toContain(EXPLORE_SECRET);
  });

  it('GraphPattern opcional não elimina o pai quando o hop é negado', () => {
    const catalog = seedExploreCatalog();
    const pattern = {
      ...buildGoldenGraphPattern(),
      nodes: [
        { id: 'c', objectTypeId: 'ot.customer', primaryKey: 'C1' },
        { id: 'o', objectTypeId: 'ot.sales_order' },
        { id: 'n', objectTypeId: 'ot.internal_note' },
      ],
      edges: [
        { id: 'e1', source: 'c', target: 'o', linkTypeId: 'lt.placed' },
        { id: 'e2', source: 'c', target: 'n', linkTypeId: 'lt.noted', optional: true },
      ],
    };
    const bob = executeGraphPattern({ catalog, pattern, principal: 'bob', authorizer: authz() });
    expect(bob.total).toBe(1);
    expect(bob.matches[0]!.bindings.some((b) => b.objectTypeId === 'ot.internal_note')).toBe(false);
  });

  it('investigation: hidden property e tipo negado não indexam hit', () => {
    const catalog = seedExploreCatalog();
    const index = buildInvestigationIndex(catalog, { nextId: createIdGenerator() });
    const bobSecret = singleLevelSearch(catalog, index, EXPLORE_SECRET.toLowerCase(), 'bob', authz());
    const bobNote = singleLevelSearch(catalog, index, 'watchlist', 'bob', authz());
    const aliceNote = singleLevelSearch(catalog, index, 'watchlist', 'alice', authz());
    expect(bobSecret.total).toBe(0);
    expect(bobNote.total).toBe(0);
    expect(aliceNote.hits[0]?.primaryKey).toBe('N1');
  });

  it('transformer canonicalize+truncate+concat', () => {
    expect(
      transformTokens(['Alice', 'Wonderland'], [
        { type: 'canonicalize', toLower: true },
        { type: 'truncate', maxLength: 5 },
      ]),
    ).toEqual(['alice', 'wonde']);
    expect(transformTokens(['a', 'b'], [{ type: 'concatenate', delimiter: '-' }])).toEqual(['a-b']);
  });

  it('two-level search respeita range e ACL', () => {
    const catalog = seedExploreCatalog();
    const index = buildInvestigationIndex(catalog, { nextId: createIdGenerator() });
    const hit = twoLevelSearch(catalog, index, 'acme', 'acme|', 'acme|zzzz', 'bob', authz());
    expect(hit.level).toBe('two');
    expect(hit.hits.some((h) => h.primaryKey === 'C1')).toBe(true);
  });

  it('scorer rankeia por peso e não inclui tipo negado', () => {
    const catalog = seedExploreCatalog();
    const notes = catalog.objects.filter((o) => o.objectTypeId === 'ot.internal_note');
    const result = computeObjectScores(
      notes,
      [
        {
          id: 'len',
          name: 'len',
          sourceFields: ['body'],
          defaultWeight: 100,
          score: () => 80,
        },
      ],
      [{ metricId: 'len', weight: 100 }],
      'bob',
      authz(),
    );
    expect(result.scores).toEqual([]);
  });

  it('bindings: path, autocomplete e projeção sem propriedade oculta', () => {
    const catalog = seedExploreCatalog();
    const store = createBindingStore();
    const so1 = catalog.objects.find((o) => o.primaryKey === 'SO-1')!;
    bindSlot(store, 'o1', so1, 'bob', authz());
    expect(evaluateExpression('o1.amount', store, 'bob', authz()).value).toBe(1200);
    expect(evaluateExpression('o1.internal', store, 'bob', authz()).value).toBeUndefined();
    expect(suggestBindings(store, 'o1.', 'bob', authz())).not.toContain('internal');
    expect(projectObject(so1, ['internal', 'amount'], 'bob', authz())).toEqual({ amount: 1200 });
    const aliceProj = projectObject(so1, ['internal'], 'alice', authz());
    expect(aliceProj.internal).toBe(EXPLORE_SECRET);
  });
});
