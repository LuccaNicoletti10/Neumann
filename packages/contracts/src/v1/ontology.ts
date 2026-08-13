/**
 * contracts — src/v1/ontology.ts
 * Ontology Registry versionado (Passo 17). Shape congelado.
 *
 * US 7,962,495 … US 10,872,067 — dynamic ontology (ObjectType/PropertyType).
 * US20100070426 / US 9,229,966 — object modeling (tipos semânticos).
 *
 * Regra: mudança = nova ontology_version (nunca update in-place).
 * SEMÂNTICA = o que existe · CINÉTICA = o que pode acontecer (stubs até Bloco 8).
 */

/** Identificadores opacos. */
export type OntologyId = string;
export type OntologyVersionId = string;
export type ObjectTypeId = string;
export type PropertyTypeId = string;
export type LinkTypeId = string;
export type ActionTypeId = string;
export type FunctionTypeId = string;

/** Camada da definição. */
export type OntologyLayer = 'SEMANTIC' | 'KINETIC';

/** Tipo base de valor de propriedade. */
export type PropertyBaseType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'object_ref'
  | 'struct';

/** Validator declarativo (kernel — sem code module arbitrário neste passo). */
export type PropertyValidator =
  | { kind: 'regex'; pattern: string }
  | { kind: 'set'; values: string[] }
  | { kind: 'required' };

/** Componente de property estruturada (ex.: Name → First/Last). */
export interface PropertyComponent {
  name: string;
  baseType?: PropertyBaseType;
  required?: boolean;
}

/** PropertyType — SEMÂNTICO. */
export interface PropertyTypeDef {
  id: PropertyTypeId;
  displayName: string;
  baseType: PropertyBaseType;
  components?: PropertyComponent[];
  validators?: PropertyValidator[];
  /** Palavras associadas (busca futura). */
  associatedWords?: string[];
  description?: string;
}

/** ObjectType — SEMÂNTICO. */
export interface ObjectTypeDef {
  id: ObjectTypeId;
  displayName: string;
  /** Tipo base / herança simples (URI ou id). */
  baseType?: string;
  /** PropertyTypes neste ObjectType. */
  propertyTypeIds: PropertyTypeId[];
  description?: string;
}

/** LinkType tipado entre ObjectTypes — SEMÂNTICO. */
export interface LinkTypeDef {
  id: LinkTypeId;
  displayName: string;
  sourceObjectTypeId: ObjectTypeId;
  targetObjectTypeId: ObjectTypeId;
  /** Cardinalidade simplificada. */
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N';
  description?: string;
}

/** Status de um ActionType. */
export type ActionTypeStatus = 'ACTIVE' | 'EXPERIMENTAL' | 'DEPRECATED';

/** Parâmetro tipado de uma Action. */
export interface ActionParameterDef {
  displayName?: string;
  description?: string;
  /** Tipo base (alinhado a PropertyBaseType) ou referência a objeto. */
  baseType: PropertyBaseType | 'object_reference';
  required?: boolean;
  /** Quando baseType = object_reference. */
  objectTypeId?: ObjectTypeId;
}

/** Critério de submissão (pré-condição declarativa). */
export interface ActionSubmissionCriterion {
  kind: 'property_equals' | 'property_in' | 'object_exists' | 'always';
  /** ObjectType do parâmetro/objeto avaliado. */
  objectTypeId?: ObjectTypeId;
  /** Nome do parâmetro que carrega a primary key. */
  primaryKeyParam?: string;
  propertyTypeId?: PropertyTypeId;
  equals?: unknown;
  inValues?: unknown[];
}

/** Regra de mutação ontológica executada pela Action. */
export type ActionRule =
  | {
      kind: 'create_object';
      objectTypeId: ObjectTypeId;
      /** Param → property map; `$param` refs. */
      primaryKeyFromParam: string;
      propertiesFromParams?: Record<PropertyTypeId, string>;
    }
  | {
      kind: 'modify_object';
      objectTypeId: ObjectTypeId;
      primaryKeyFromParam: string;
      setPropertiesFromParams: Record<PropertyTypeId, string>;
    }
  | {
      kind: 'delete_object';
      objectTypeId: ObjectTypeId;
      primaryKeyFromParam: string;
    }
  | {
      kind: 'create_link';
      linkTypeId: LinkTypeId;
      sourceObjectTypeId: ObjectTypeId;
      sourcePrimaryKeyFromParam: string;
      targetObjectTypeId: ObjectTypeId;
      targetPrimaryKeyFromParam: string;
    }
  | {
      kind: 'delete_link';
      linkTypeId: LinkTypeId;
      sourceObjectTypeId: ObjectTypeId;
      sourcePrimaryKeyFromParam: string;
      targetObjectTypeId: ObjectTypeId;
      targetPrimaryKeyFromParam: string;
    };

/** Side effect fora do object store (writeback futuro). */
export type ActionSideEffect =
  | { kind: 'webhook'; urlFromParam?: string; url?: string }
  | { kind: 'notification'; channel: string; messageFromParam?: string }
  | { kind: 'connector_writeback'; connectorId: string; operation: string };

/**
 * ActionType — CINÉTICO.
 * Campos mínimos (id/displayName/inputObjectTypeIds) preservados para Passo 17.
 * Campos ricos (parameters/rules/…) alimentam o Action engine (Passo 24).
 */
export interface ActionTypeDef {
  id: ActionTypeId;
  /** API name Foundry-style; default = id. */
  apiName?: string;
  displayName: string;
  inputObjectTypeIds: ObjectTypeId[];
  description?: string;
  parameters?: Record<string, ActionParameterDef>;
  submissionCriteria?: ActionSubmissionCriterion[];
  rules?: ActionRule[];
  sideEffects?: ActionSideEffect[];
  permissions?: string[];
  version?: number;
  status?: ActionTypeStatus;
}

/** FunctionType — CINÉTICO (definição apenas; registry = Passo 23). */
export interface FunctionTypeDef {
  id: FunctionTypeId;
  displayName: string;
  inputObjectTypeIds: ObjectTypeId[];
  description?: string;
}

/** Snapshot imutável de uma versão da ontologia. */
export interface OntologyVersion {
  id: OntologyVersionId;
  ontologyId: OntologyId;
  /** Número monotônico 1..N. */
  versionNumber: number;
  parentVersionId?: OntologyVersionId;
  createdAt: string;
  createdBy: string;
  /** Content-hash do snapshot (determinístico). */
  contentHash: string;
  status: 'COMMITTED';
  objectTypes: Record<ObjectTypeId, ObjectTypeDef>;
  propertyTypes: Record<PropertyTypeId, PropertyTypeDef>;
  linkTypes: Record<LinkTypeId, LinkTypeDef>;
  actionTypes: Record<ActionTypeId, ActionTypeDef>;
  functionTypes: Record<FunctionTypeId, FunctionTypeDef>;
}

/** Cabeçalho da ontologia (ponteiro para latest). */
export interface Ontology {
  id: OntologyId;
  name: string;
  description?: string;
  createdAt: string;
  latestVersionId?: OntologyVersionId;
  /** Após rollback, latest aponta para a versão restaurada. */
}

/** Draft mutável usado só até commit (nunca vira versão in-place). */
export interface OntologyDraft {
  ontologyId: OntologyId;
  baseVersionId?: OntologyVersionId;
  objectTypes: Record<ObjectTypeId, ObjectTypeDef>;
  propertyTypes: Record<PropertyTypeId, PropertyTypeDef>;
  linkTypes: Record<LinkTypeId, LinkTypeDef>;
  actionTypes: Record<ActionTypeId, ActionTypeDef>;
  functionTypes: Record<FunctionTypeId, FunctionTypeDef>;
}

export interface CreateOntologyInput {
  name: string;
  description?: string;
  createdBy?: string;
}

export interface CommitOntologyInput {
  ontologyId: OntologyId;
  /** Se omitido, usa draft aberto. */
  createdBy?: string;
}

/** Contrato OntologyRegistry (Passo 17). Callers always await (PG is durable). */
export interface OntologyRegistry {
  createOntology(input: CreateOntologyInput): Promise<Ontology>;
  getOntology(ontologyId: OntologyId): Promise<Ontology | undefined>;
  /** List all ontologies (persisted). */
  listOntologies(): Promise<Ontology[]>;
  /** Abre draft a partir da latest (ou vazio). */
  openDraft(ontologyId: OntologyId): Promise<OntologyDraft>;
  getDraft(ontologyId: OntologyId): Promise<OntologyDraft | undefined>;
  addPropertyType(ontologyId: OntologyId, def: PropertyTypeDef): Promise<void>;
  addObjectType(ontologyId: OntologyId, def: ObjectTypeDef): Promise<void>;
  addLinkType(ontologyId: OntologyId, def: LinkTypeDef): Promise<void>;
  addActionType(ontologyId: OntologyId, def: ActionTypeDef): Promise<void>;
  addFunctionType(ontologyId: OntologyId, def: FunctionTypeDef): Promise<void>;
  /** Commit = nova OntologyVersion imutável. */
  commit(input: CommitOntologyInput): Promise<OntologyVersion>;
  getVersion(versionId: OntologyVersionId): Promise<OntologyVersion | undefined>;
  getLatestVersion(ontologyId: OntologyId): Promise<OntologyVersion | undefined>;
  listVersions(ontologyId: OntologyId): Promise<OntologyVersion[]>;
  /**
   * Rollback: cria NOVA versão cujo conteúdo = snapshot da target
   * (não reescreve histórico).
   */
  rollback(
    ontologyId: OntologyId,
    targetVersionId: OntologyVersionId,
    createdBy?: string,
  ): Promise<OntologyVersion>;
  /** Diff superficial entre duas versões. */
  diff(a: OntologyVersionId, b: OntologyVersionId): Promise<OntologyDiff>;
}

export interface OntologyDiff {
  a: OntologyVersionId;
  b: OntologyVersionId;
  addedObjectTypes: ObjectTypeId[];
  removedObjectTypes: ObjectTypeId[];
  changedObjectTypes: ObjectTypeId[];
  addedPropertyTypes: PropertyTypeId[];
  removedPropertyTypes: PropertyTypeId[];
  changedPropertyTypes: PropertyTypeId[];
  addedLinkTypes: LinkTypeId[];
  removedLinkTypes: LinkTypeId[];
}

export function buildGoldenObjectType(): ObjectTypeDef {
  return {
    id: 'ot.customer',
    displayName: 'Customer',
    baseType: 'ot.entity',
    propertyTypeIds: ['pt.name', 'pt.email'],
    description: 'Generic customer entity',
  };
}

export function assertObjectTypeDef(def: ObjectTypeDef): void {
  if (!def.id) throw new Error('ObjectTypeDef: id obrigatório');
  if (!def.displayName) throw new Error('ObjectTypeDef: displayName obrigatório');
  if (!Array.isArray(def.propertyTypeIds)) {
    throw new Error('ObjectTypeDef: propertyTypeIds[] obrigatório');
  }
}
