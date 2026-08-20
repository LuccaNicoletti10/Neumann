/**
 * contracts — src/v1/policy.ts
 * Policy engine + EPID + authorize (Passo 16). Shape congelado.
 *
 * US 10,432,469 — EPIDs por nó; enforcement por EPID.
 * US 10,397,229 — authorize em create/modify/delete de recursos.
 * US20150188715 — audit hash-chained (tipos em audit.ts).
 */

/** Principal autenticado (opaco). */
export type PrincipalId = string;

/** Identificador de política efetiva (EPID). */
export type Epid = string;

/** Identificador de nó no grafo de recursos. */
export type PolicyNodeId = string;

/** Identificador de recurso digital. */
export type ResourceId = string;

/** Operações cobertas pelo authorize. */
export type PolicyOperation =
  | 'read'
  | 'create'
  | 'modify'
  | 'delete'
  | 'list'
  | 'count';

/** Decisão de authorize. */
export type AuthzDecision = 'allow' | 'deny' | 'partial';

/** Política atribuída a um nó (null = herda do ancestral). */
export type NodePolicyId = string | null;

/** Contexto opcional da decisão. */
export interface AuthzContext {
  /** Tags / classificação do recurso. */
  classification?: string;
  /** Metadados extras (não identificadores sensíveis). */
  annotations?: Record<string, string>;
}

/** Pedido de autorização. */
export interface AuthorizeRequest {
  principal: PrincipalId;
  resource: ResourceId;
  operation: PolicyOperation;
  context?: AuthzContext;
}

/** Resposta de authorize. */
export interface AuthorizeResult {
  decision: AuthzDecision;
  /** EPIDs que o principal detém. */
  principalEpids: Epid[];
  /** EPID efetivo do recurso (se resolvido). */
  resourceEpid: Epid | null;
  reason: string;
}

/** Célula da security matrix por API. */
export interface SecurityMatrixCell {
  operation: PolicyOperation;
  decision: AuthzDecision;
  /** true se a API não deve revelar existência/count. */
  hideExistence: boolean;
}

/** Security matrix retornada em toda superfície de API. */
export interface SecurityMatrix {
  principal: PrincipalId;
  resource: ResourceId;
  cells: SecurityMatrixCell[];
}

/** Nó no grafo de policy (US 10,432,469). */
export interface PolicyNode {
  id: PolicyNodeId;
  resourceId: ResourceId;
  /** null = herda do primeiro ancestral com policy. */
  policy: NodePolicyId;
  parentId: PolicyNodeId | null;
  epid: Epid | null;
}

/** Capacidades de criação/modificação (US 10,397,229). */
export interface ResourcePermissions {
  canCreate: boolean;
  canModify: boolean;
  canDelete: boolean;
  canRead: boolean;
}

/** Especificação para criar um recurso (kernel — sem pods). */
export interface ResourceCreateSpec {
  resourceId: ResourceId;
  resourceType: string;
  parentId?: PolicyNodeId | null;
  /** Policy do nó (ou null para herdar). */
  policy?: NodePolicyId;
  annotations?: Record<string, string>;
}

/** Resultado de tentativa de criação. */
export interface ResourceCreateResult {
  ok: boolean;
  resourceId?: ResourceId;
  nodeId?: PolicyNodeId;
  epid?: Epid | null;
  denyReason?: string;
}

/** Contrato do policy engine. */
export interface PolicyEngine {
  /** Registra principal → policies (grupos) que ele pode acessar. */
  grantPolicy(principal: PrincipalId, policyId: string): void;
  revokePolicy(principal: PrincipalId, policyId: string): void;
  /** Adiciona nó ao grafo e calcula EPID. */
  addNode(node: Omit<PolicyNode, 'epid'>): PolicyNode;
  updateNodePolicy(nodeId: PolicyNodeId, policy: NodePolicyId): PolicyNode;
  getNode(nodeId: PolicyNodeId): PolicyNode | undefined;
  getNodeByResource(resourceId: ResourceId): PolicyNode | undefined;
  epidsForPrincipal(principal: PrincipalId): Epid[];
  authorize(req: AuthorizeRequest): AuthorizeResult;
  /** Security matrix para uma API/recurso. */
  securityMatrix(principal: PrincipalId, resource: ResourceId): SecurityMatrix;
  /** Create com admissions (US 10,397,229). */
  createResource(principal: PrincipalId, spec: ResourceCreateSpec): ResourceCreateResult;
  /**
   * Leitura enforcement: sem permissão → items=[], count = |autorizados|
   * (nunca o tamanho do universo negado; 0 ≡ conjunto vazio).
   */
  securedRead<T extends { resourceId: ResourceId }>(
    principal: PrincipalId,
    items: readonly T[],
  ): { items: T[]; count: number; matrix: SecurityMatrix[] };
}

export function buildGoldenAuthorizeRequest(): AuthorizeRequest {
  return {
    principal: 'user-alice',
    resource: 'ds-sales-v1',
    operation: 'read',
    context: { classification: 'internal' },
  };
}

export function assertAuthorizeResult(r: AuthorizeResult): void {
  if (!['allow', 'deny', 'partial'].includes(r.decision)) {
    throw new Error('AuthorizeResult: decision inválida');
  }
  if (!Array.isArray(r.principalEpids)) {
    throw new Error('AuthorizeResult: principalEpids[] obrigatório');
  }
  if (typeof r.reason !== 'string') {
    throw new Error('AuthorizeResult: reason obrigatório');
  }
}

/** Read operations may proceed on `allow` or `partial`. */
export function isReadOperation(operation: PolicyOperation): boolean {
  return operation === 'read' || operation === 'list' || operation === 'count';
}

/**
 * Mutations and admin writes. WHY: EPID `partial` means inherited read;
 * write requires an explicit node policy (`allow`).
 */
export function allowsMutation(result: AuthorizeResult): boolean {
  return result.decision === 'allow';
}

/**
 * Read may proceed on `allow` or `partial`. `deny` is hidden-miss.
 * Field masks still apply after a `partial` read.
 */
export function allowsRead(result: AuthorizeResult): boolean {
  return result.decision === 'allow' || result.decision === 'partial';
}

/** Single interpreter for HTTP/Actions/Functions. Never `decision !== 'deny'` on writes. */
export function authorizeProceeds(
  operation: PolicyOperation,
  result: AuthorizeResult,
): boolean {
  return isReadOperation(operation) ? allowsRead(result) : allowsMutation(result);
}
