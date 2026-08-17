/**
 * policy-engine — src/core/noninterference.ts
 * Suite dos 8 canais: count, error, autocomplete, index, embeddings, cache, LLM, logs.
 */

import {
  HIDDEN_MISS,
  fingerprintsEqual,
  type NoninterferenceReport,
  type PolicyEngine,
  type ProbeResult,
} from 'contracts';
import { createQueryEngine, type QueryEngine } from 'query-api';

import { completeAuthorized, embedAuthorized } from './closed-channels.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { createPolicyEngine } from './engine.js';
import { logFingerprint } from './log-redact.js';
import { createPrincipalCache, type PrincipalCache } from './principal-cache.js';

export const NI_SECRET = 'NI-SECRET-PAYLOAD';

export interface NiWorld {
  engine: PolicyEngine;
  search: QueryEngine;
  cache: PrincipalCache;
  logs: string[];
}

function canRead(engine: PolicyEngine, principal: string, resourceId: string): boolean {
  const d = engine.authorize({ principal, resource: resourceId, operation: 'read' }).decision;
  return d === 'allow' || d === 'partial';
}

export function seedWorld(includeSecret: boolean): NiWorld {
  const clock = createDeterministicClock('2024-06-01T12:00:00.000Z');
  const engine = createPolicyEngine({ clock, nextId: createIdGenerator() });
  engine.grantPolicy('alice', 'finance');
  engine.grantPolicy('bob', 'ops');
  engine.addNode({ id: 'n-sales', resourceId: 'obj-c1', policy: 'ops', parentId: null });
  if (includeSecret) {
    engine.addNode({ id: 'n-secret', resourceId: 'obj-c2', policy: 'finance', parentId: null });
  }

  const search = createQueryEngine({ clock, nextId: createIdGenerator() });
  search.upsert({
    id: 'obj-c1',
    objectTypeId: 'ot.customer',
    primaryKey: 'C1',
    properties: { name: 'Acme', status: 'active' },
    aclPrincipals: ['alice', 'bob', 'analysts'],
    classification: 'Unclassified',
    sourceUpdatedAt: '2024-06-01T11:59:00.000Z',
  });
  if (includeSecret) {
    search.upsert({
      id: 'obj-c2',
      objectTypeId: 'ot.customer',
      primaryKey: 'C2',
      properties: { name: 'SecretCo', note: NI_SECRET },
      aclPrincipals: ['alice'],
      classification: 'Confidential',
      sourceUpdatedAt: '2024-06-01T11:59:30.000Z',
    });
  }

  const cache = createPrincipalCache();
  if (includeSecret) {
    cache.set('alice', 'obj-c2', NI_SECRET);
  }

  return { engine, search, cache, logs: [] };
}

function lookupError(world: NiWorld, principal: string, resourceId: string): string {
  if (!canRead(world.engine, principal, resourceId)) {
    return JSON.stringify(HIDDEN_MISS);
  }
  return JSON.stringify({ ok: true, id: resourceId });
}

export function probePrincipal(world: NiWorld, principal: string): ProbeResult {
  const bob: { id: string; groups: string[]; viewingLevel: string } = {
    id: principal,
    groups: ['analysts'],
    viewingLevel: 'Unclassified',
  };

  const universe = includeIds(world);
  const view = world.engine.securedRead(
    principal,
    universe.map((id) => ({ resourceId: id })),
  );

  const indexed = world.search.execute({ q: 'acme', facetFields: ['name'] }, bob);
  const secretQ = world.search.execute({ q: NI_SECRET, facetFields: ['name'] }, bob);

  const errSecret = lookupError(world, principal, 'obj-c2');
  const errGhost = lookupError(world, principal, 'obj-ghost');
  world.logs.push(`get obj-c2 → ${errSecret}`);
  world.logs.push(`get obj-ghost → ${errGhost}`);

  const embed = embedAuthorized(
    (p, r) => canRead(world.engine, p, r),
    principal,
    'obj-c2',
    NI_SECRET,
  );
  const llm = completeAuthorized(
    (p, r) => canRead(world.engine, p, r),
    principal,
    'obj-c2',
    `summarize ${NI_SECRET}`,
  );

  const cacheHit = world.cache.get(principal, 'obj-c2');

  return {
    principal,
    observations: [
      { channel: 'count', fingerprint: JSON.stringify({ n: view.count, search: indexed.total }) },
      { channel: 'error', fingerprint: JSON.stringify({ secret: errSecret, ghost: errGhost }) },
      {
        channel: 'autocomplete',
        fingerprint: JSON.stringify(
          [...indexed.autocomplete, ...secretQ.autocomplete].map((s) => s.text).sort(),
        ),
      },
      {
        channel: 'index',
        fingerprint: JSON.stringify({
          hits: indexed.hits.map((h) => h.primaryKey).sort(),
          secretHits: secretQ.hits.map((h) => h.primaryKey).sort(),
          facets: indexed.facets,
        }),
      },
      { channel: 'embeddings', fingerprint: JSON.stringify(embed) },
      { channel: 'cache', fingerprint: JSON.stringify(cacheHit ?? null) },
      { channel: 'llm', fingerprint: llm },
      { channel: 'logs', fingerprint: logFingerprint(world.logs, [NI_SECRET]) },
    ],
  };
}

function includeIds(world: NiWorld): string[] {
  const ids = ['obj-c1'];
  if (world.engine.getNodeByResource('obj-c2')) ids.push('obj-c2');
  return ids;
}

export function runNoninterferenceSuite(): NoninterferenceReport {
  const present = seedWorld(true);
  const absent = seedWorld(false);
  const a = probePrincipal(present, 'bob');
  const b = probePrincipal(absent, 'bob');
  const leaked = fingerprintsEqual(a, b);
  return { ok: leaked.length === 0, leaked, present: a, absent: b };
}
