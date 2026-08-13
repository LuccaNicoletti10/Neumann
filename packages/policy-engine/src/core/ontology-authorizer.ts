/**
 * policy-engine — src/core/ontology-authorizer.ts
 *
 * PEÇA 4 — permissão herdada da ontologia, declarativa.
 *
 * Hoje o executor checa `action:<nome>` com um AuthorizeFn opaco e a
 * leitura no /api/v2 não checa nada. Este módulo dá a granularidade
 * que faltava SEM inventar infraestrutura nova: uma configuração
 * declarativa (papéis → concessões) que produz:
 *
 *   - authorize()          → AuthorizeFn p/ injetar no ActionExecutor
 *                            e nas rotas de leitura
 *   - redactProperties()   → remove propriedades ocultas por papel
 *   - filterReadable()     → filtra listas por permissão de leitura
 *
 * Convenção de resource (compatível com o executor atual):
 *   action:<apiName>            operação 'modify'
 *   object:<objectTypeId>       operações 'read' | 'modify'
 *
 * Exemplo (contas a pagar):
 *   createOntologyAuthorizer({
 *     roles: {
 *       'fernanda.financeiro': ['financeiro'],
 *       'svc-projector':       ['servico'],
 *       'lucca':               ['admin'],
 *     },
 *     grants: [
 *       { role: 'financeiro', actions: ['AprovarTitulo','AgendarPagamento'],
 *         objectTypes: ['Titulo','NotaFiscal','Fornecedor'], operations: ['read','modify'] },
 *       { role: 'financeiro', objectTypes: ['Fornecedor'],
 *         hiddenProperties: ['limite_credito'] },
 *       { role: 'servico',  objectTypes: ['*'], actions: ['*'], operations: ['read','modify'] },
 *       { role: 'admin',    objectTypes: ['*'], actions: ['*'], operations: ['read','modify'] },
 *     ],
 *   })
 */

import type { AuthorizeRequest, AuthorizeResult } from 'contracts';

export type PolicyOp = 'read' | 'modify';

export interface OntologyGrant {
  role: string;
  /** ObjectTypes concedidos ('*' = todos). */
  objectTypes?: string[];
  /** Actions concedidas por apiName ('*' = todas). */
  actions?: string[];
  /** Operações concedidas sobre os objectTypes. Default: ['read']. */
  operations?: PolicyOp[];
  /** Propriedades OCULTADAS deste papel nos objectTypes listados. */
  hiddenProperties?: string[];
}

export interface OntologyAuthorizerConfig {
  /** principal → papéis. Principals ausentes = sem papéis = deny. */
  roles: Record<string, string[]>;
  grants: OntologyGrant[];
  /** Papel implícito de todo principal autenticado (opcional). */
  everyoneRole?: string;
}

/**
 * Single runtime policy for Actions + Reads (platform-api).
 * Distinct from the EPID `PolicyEngine` graph.
 */
export interface OntologyAuthorizer {
  authorize(req: AuthorizeRequest): AuthorizeResult;
  authorizeRead(principal: string, objectTypeId: string): AuthorizeResult;
  authorizeMutation(principal: string, objectTypeId: string): AuthorizeResult;
  authorizeAction(principal: string, actionApiName: string): AuthorizeResult;
  explainDecision(req: AuthorizeRequest): AuthorizeResult;
  canReadObjectType(principal: string, objectTypeId: string): boolean;
  canRunAction(principal: string, actionApiName: string): boolean;
  /** Remove propriedades ocultas ao papel. Não muta o original. */
  redactProperties<T extends Record<string, unknown>>(
    principal: string,
    objectTypeId: string,
    properties: T,
  ): Partial<T>;
  /** Filtra registros por permissão de leitura do objectType. */
  filterReadable<T extends { objectTypeId: string }>(
    principal: string,
    records: readonly T[],
  ): T[];
}

function matches(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return false;
  return list.includes('*') || list.includes(value);
}

export function createOntologyAuthorizer(
  config: OntologyAuthorizerConfig,
): OntologyAuthorizer {
  function rolesOf(principal: string): string[] {
    const base = config.roles[principal] ?? [];
    return config.everyoneRole ? [...base, config.everyoneRole] : base;
  }

  function grantsFor(principal: string): OntologyGrant[] {
    const roles = new Set(rolesOf(principal));
    return config.grants.filter((g) => roles.has(g.role));
  }

  function decide(
    principal: string,
    resource: string,
    operation: string,
  ): { allow: boolean; reason: string } {
    const grants = grantsFor(principal);
    if (grants.length === 0) {
      return { allow: false, reason: `principal "${principal}" has no roles` };
    }

    if (resource.startsWith('action:')) {
      const apiName = resource.slice('action:'.length);
      const ok = grants.some((g) => matches(g.actions, apiName));
      return {
        allow: ok,
        reason: ok
          ? `action "${apiName}" granted`
          : `action "${apiName}" not granted to roles [${rolesOf(principal).join(', ')}]`,
      };
    }

    if (resource.startsWith('object:')) {
      const objectTypeId = resource.slice('object:'.length);
      const op: PolicyOp = operation === 'modify' ? 'modify' : 'read';
      const ok = grants.some(
        (g) =>
          matches(g.objectTypes, objectTypeId) &&
          (g.operations ?? ['read']).includes(op),
      );
      return {
        allow: ok,
        reason: ok
          ? `object "${objectTypeId}" ${op} granted`
          : `object "${objectTypeId}" ${op} not granted`,
      };
    }

    // Recurso fora da convenção: nega e nomeia (fail-closed explicável).
    return { allow: false, reason: `unknown resource scheme: "${resource}"` };
  }

  function toResult(
    principal: string,
    resource: string,
    operation: string,
  ): AuthorizeResult {
    const { allow, reason } = decide(principal, resource, operation);
    return {
      decision: allow ? 'allow' : 'deny',
      principalEpids: rolesOf(principal),
      resourceEpid: resource,
      reason,
    };
  }

  return {
    authorize(req: AuthorizeRequest): AuthorizeResult {
      return toResult(req.principal, String(req.resource), String(req.operation));
    },

    authorizeRead(principal, objectTypeId) {
      return toResult(principal, `object:${objectTypeId}`, 'read');
    },

    authorizeMutation(principal, objectTypeId) {
      return toResult(principal, `object:${objectTypeId}`, 'modify');
    },

    authorizeAction(principal, actionApiName) {
      return toResult(principal, `action:${actionApiName}`, 'modify');
    },

    explainDecision(req) {
      return toResult(req.principal, String(req.resource), String(req.operation));
    },

    canReadObjectType(principal, objectTypeId) {
      return decide(principal, `object:${objectTypeId}`, 'read').allow;
    },

    canRunAction(principal, actionApiName) {
      return decide(principal, `action:${actionApiName}`, 'modify').allow;
    },

    redactProperties(principal, objectTypeId, properties) {
      const hidden = new Set<string>();
      for (const g of grantsFor(principal)) {
        if (matches(g.objectTypes, objectTypeId)) {
          for (const p of g.hiddenProperties ?? []) hidden.add(p);
        }
      }
      if (hidden.size === 0) return { ...properties };
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(properties)) {
        if (!hidden.has(k)) out[k] = v;
      }
      return out as Partial<typeof properties>;
    },

    filterReadable(principal, records) {
      return records.filter((r) =>
        decide(principal, `object:${r.objectTypeId}`, 'read').allow,
      );
    },
  };
}

/** Test/demo policy: every principal can read+modify everything. */
export function createAllowAllAuthorizer(): OntologyAuthorizer {
  return createOntologyAuthorizer({
    everyoneRole: 'world',
    roles: {},
    grants: [
      {
        role: 'world',
        objectTypes: ['*'],
        actions: ['*'],
        operations: ['read', 'modify'],
      },
    ],
  });
}

/** Production-shaped deny: no roles → fail-closed. */
export function createDenyAllAuthorizer(): OntologyAuthorizer {
  return createOntologyAuthorizer({ roles: {}, grants: [] });
}
