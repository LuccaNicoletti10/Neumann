/**
 * contracts — src/v1/federation.ts
 * Federação de fontes que não podem ser copiadas (Passo 31). Shape congelado.
 *
 * US 10,402,397 — consultar fonte remota via pushdown, sem ingestão.
 * US 11,281,659 — representação temporária (TTL, provenance federated) antes de materializar.
 * US 11,681,690 — ACL da fonte, redaction, copy-on-write, links ausentes do store.
 *
 * Connector NUNCA importa Ontology. TemporaryObject é a vista de sessão;
 * promote é a materialização opcional (não é DatasetStore).
 */

import type { FederatedQueryResult, FederatedRowAcl, ObjectRef, PushdownSpec } from './connector.js';

export type FederatedProvenance = 'federated' | 'promoted';
export type FederatedViewKind = 'temporary' | 'platform';
export type AclLevel = 'read' | 'write' | 'admin';

export interface AclEntry {
  principal: string;
  level: AclLevel;
}

/** Alias estável: ACL recuperada da fonte (US 11,681,690). */
export type AccessControlProperties = FederatedRowAcl;

export interface FederationPrincipal {
  id: string;
  groups?: string[];
  viewingLevel?: string;
}

export interface DataFragment {
  id: string;
  objectId: string;
  sourceSystemId: string;
  objectName: string;
  rawData: Record<string, unknown>;
  lastUpdated: string;
  acl: AccessControlProperties;
}

export interface FederatedLink {
  targetId: string;
  linkType: string;
  /** true = exibido mesmo sem o alvo no store (US 11,681,690). */
  absentFromStore?: boolean;
}

export interface PromotionMetadata {
  fragmentIds: string[];
  /** Propriedades adicionadas/editadas pelo usuário (sobrevivem ao refresh da fonte). */
  promotedProperties: string[];
  promotedLinks: FederatedLink[];
  promotedAt: string;
  promotedBy: string;
}

export interface TemporaryObject {
  kind: 'temporary';
  id: string;
  objectTypeId: string;
  properties: Record<string, unknown>;
  links: FederatedLink[];
  fragments: DataFragment[];
  promoted: boolean;
  promotionMetadata?: PromotionMetadata;
  acl: AccessControlProperties;
  copyOnWrite: boolean;
  provenance: FederatedProvenance;
  expiresAt: string;
}

export interface PlatformObject {
  kind: 'platform';
  id: string;
  objectTypeId: string;
  properties: Record<string, unknown>;
  links: FederatedLink[];
  sourceFragments: DataFragment[];
  promotionMetadata: PromotionMetadata;
  acl: AccessControlProperties;
  copyOnWrite: boolean;
  provenance: 'promoted';
  createdAt: string;
  updatedAt: string;
}

export type FederatedView = TemporaryObject | PlatformObject;

export type FederatedPromotion =
  | { type: 'addProperty'; key: string; value: unknown }
  | { type: 'updateProperty'; key: string; value: unknown }
  | { type: 'addLink'; targetId: string; linkType: string };

export interface FederatedScript {
  id: string;
  name: string;
  objectTypeId: string;
  getOntology: (sourceSystemId: string) => {
    objectTypes: string[];
    propertyTypes: string[];
    linkTypes: string[];
  };
  transformFragment: (fragment: DataFragment) => Partial<TemporaryObject>;
  mergeFragments: (fragments: DataFragment[]) => TemporaryObject;
  toPlatformObject: (temp: TemporaryObject, at: string) => PlatformObject;
}

export interface FederationQuery {
  objectId?: string;
  objectTypeId?: string;
  predicates?: PushdownSpec['predicates'];
  sourceIds?: string[];
  scriptId?: string;
  /** Planner deve empurrar predicados/PK para a fonte (não puxar o universo). */
  requirePushdown?: boolean;
}

export interface FederationSourceCatalogEntry {
  sourceId: string;
  objectName: string;
  objectTypeId: string;
  fields: string[];
}

export interface FederationPlan {
  objectId?: string;
  objectTypeId: string;
  scriptId: string;
  pushdowns: Array<{ sourceId: string; spec: PushdownSpec }>;
}

export type { FederatedQueryResult, ObjectRef, PushdownSpec };

export function buildGoldenPushdownSpec(): PushdownSpec {
  return {
    object: { sourceSystem: 'hr-db', objectName: 'people' },
    primaryKeys: ['P-778'],
    columns: ['id', 'name', 'phone'],
    predicates: [{ field: 'id', op: 'eq', value: 'P-778' }],
    limit: 1,
  };
}

export function buildGoldenTemporaryObject(): TemporaryObject {
  return {
    kind: 'temporary',
    id: 'P-778',
    objectTypeId: 'ot.person',
    properties: { name: 'Ada' },
    links: [],
    fragments: [],
    promoted: false,
    acl: {
      entries: [{ principal: 'alice', level: 'read' }],
      retrievedAt: '2024-06-01T12:00:00.000Z',
    },
    copyOnWrite: true,
    provenance: 'federated',
    expiresAt: '2024-06-01T12:01:00.000Z',
  };
}

export function assertPushdownSpec(spec: PushdownSpec): void {
  if (!spec.object?.sourceSystem || !spec.object.objectName) {
    throw new Error('PushdownSpec: object.sourceSystem e objectName obrigatórios');
  }
}

export function assertTemporaryObject(obj: TemporaryObject): void {
  if (obj.kind !== 'temporary') throw new Error('TemporaryObject: kind=temporary');
  if (!obj.id) throw new Error('TemporaryObject: id obrigatório');
  if (obj.provenance !== 'federated' && obj.provenance !== 'promoted') {
    throw new Error('TemporaryObject: provenance inválido');
  }
  if (!obj.copyOnWrite) throw new Error('TemporaryObject: copyOnWrite obrigatório na vista federada');
}

export function isTemporaryObject(view: FederatedView): view is TemporaryObject {
  return view.kind === 'temporary';
}

export function isPlatformObject(view: FederatedView): view is PlatformObject {
  return view.kind === 'platform';
}
