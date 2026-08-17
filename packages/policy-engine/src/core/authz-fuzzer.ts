/**
 * policy-engine — src/core/authz-fuzzer.ts
 * Fuzzer principal × resource × action × context vs oracle (US 10,044,745).
 */

import type { AuthzDecision, AuthzFuzzCase, AuthzFuzzReport, PolicyEngine, PolicyOperation } from 'contracts';

const OPS: PolicyOperation[] = ['read', 'create', 'modify', 'delete', 'list', 'count'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

export interface FuzzOracleRow {
  principal: string;
  policies: string[];
}

export interface FuzzResourceRow {
  resourceId: string;
  /** Policy efetiva (já resolvida). undefined = recurso inexistente no oracle. */
  effectivePolicy: string | null;
  explicitPolicy: boolean;
}

export function oracleAuthorize(
  principalPolicies: readonly string[],
  resource: FuzzResourceRow | undefined,
  operation: PolicyOperation,
): AuthzDecision {
  if (!resource || resource.effectivePolicy === null) return 'deny';
  if (!principalPolicies.includes(resource.effectivePolicy)) return 'deny';
  if (
    (operation === 'create' || operation === 'modify' || operation === 'delete') &&
    !resource.explicitPolicy
  ) {
    return 'partial';
  }
  return 'allow';
}

export interface RunAuthzFuzzOptions {
  engine: PolicyEngine;
  seed?: number;
  rounds?: number;
}

/**
 * Monta um grafo pequeno determinístico, depois fuzza authorize contra o oracle.
 */
export function runAuthzFuzz(opts: RunAuthzFuzzOptions): AuthzFuzzReport {
  const seed = opts.seed ?? 28;
  const rounds = opts.rounds ?? 200;
  const rng = mulberry32(seed);
  const engine = opts.engine;

  engine.grantPolicy('alice', 'finance');
  engine.grantPolicy('bob', 'ops');
  engine.grantPolicy('cara', 'finance');
  const org = engine.addNode({
    id: 'fz-org',
    resourceId: 'org',
    policy: 'finance',
    parentId: null,
  });
  engine.addNode({
    id: 'fz-sales',
    resourceId: 'ds-sales',
    policy: 'finance',
    parentId: org.id,
  });
  engine.addNode({
    id: 'fz-ops',
    resourceId: 'ds-ops',
    policy: 'ops',
    parentId: org.id,
  });
  engine.addNode({
    id: 'fz-leaf',
    resourceId: 'ds-leaf',
    policy: null,
    parentId: org.id,
  });

  const principals: FuzzOracleRow[] = [
    { principal: 'alice', policies: ['finance'] },
    { principal: 'bob', policies: ['ops'] },
    { principal: 'cara', policies: ['finance'] },
    { principal: 'eve', policies: [] },
  ];
  const resources: FuzzResourceRow[] = [
    { resourceId: 'org', effectivePolicy: 'finance', explicitPolicy: true },
    { resourceId: 'ds-sales', effectivePolicy: 'finance', explicitPolicy: true },
    { resourceId: 'ds-ops', effectivePolicy: 'ops', explicitPolicy: true },
    { resourceId: 'ds-leaf', effectivePolicy: 'finance', explicitPolicy: false },
    { resourceId: 'ghost', effectivePolicy: null, explicitPolicy: false },
  ];

  const violations: AuthzFuzzReport['violations'] = [];
  for (let i = 0; i < rounds; i += 1) {
    const who = pick(rng, principals);
    const res = pick(rng, resources);
    const operation = pick(rng, OPS);
    const ctx = rng() < 0.3 ? { classification: pick(rng, ['Unclassified', 'Confidential']) } : undefined;
    const caze: AuthzFuzzCase = {
      principal: who.principal,
      resource: res.resourceId,
      operation,
      context: ctx,
    };
    const expected = oracleAuthorize(who.policies, res.effectivePolicy === null ? undefined : res, operation);
    const actual = engine.authorize({
      principal: caze.principal,
      resource: caze.resource,
      operation: caze.operation,
      context: caze.context,
    }).decision;
    if (actual !== expected) {
      violations.push({ case: caze, expected, actual });
    }
  }

  return { rounds, seed, violations };
}
