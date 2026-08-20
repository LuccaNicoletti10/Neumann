/**
 * contracts — src/v1/ontology.ts
 * Ontology Registry versionado (Passo 17). Shape congelado.
 *
 * US 7,962,495 … US 10,872,067 — dynamic ontology (ObjectType/PropertyType).
 * US20100070426 / US 9,229,966 — object modeling (tipos semânticos).
 *
 * Regra: mudança = nova ontology_version (nunca update in-place).
 * SEMÂNTICA = o que existe · CINÉTICA = o que pode acontecer (Function registry = Passo 23; Actions = Passo 24).
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
  /** When true, platform may emit an expression index on properties->>'id'. */
  indexed?: boolean;
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
  nullable?: boolean;
  /** Quando baseType = object_reference. */
  objectTypeId?: ObjectTypeId;
  /**
   * Shared variable name (US 8,732,574 family). Parameters with the same
   * `variableName` are updated together when the variable is set.
   */
  variableName?: string;
  /**
   * Allowed discrete values (enum semantics).
   * Only enforced when baseType is string, number, or boolean.
   * WHY: replaces opaque validator arrays; each validator is now typed and
   * testable without runtime reflection on a contract field that did not exist.
   */
  allowedValues?: readonly (string | number | boolean)[];
  /**
   * Regex pattern the string value must match (ECMAScript syntax).
   * Only enforced when baseType is string.
   */
  pattern?: string;
  /**
   * Numeric bounds (inclusive). Only enforced when baseType is number.
   */
  min?: number;
  max?: number;
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
    }
  | {
      /**
       * Fill a document from object properties (US 9,223,773).
       * Template is substitution-only: `{{property}}` / `{{#each list}}`.
       * No executable code.
       */
      kind: 'generate_document';
      objectTypeId: ObjectTypeId;
      primaryKeyFromParam: string;
      template?: string;
      templateFromParam?: string;
      outputProperty: PropertyTypeId;
    };

/** Side effect fora do object store (write-back Passo 25). */
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
  /** Preconditions evaluated before the transaction. */
  submissionCriteria?: ActionSubmissionCriterion[];
  rules?: ActionRule[];
  sideEffects?: ActionSideEffect[];
  /** Evaluated after rules, before write-back / SUCCEEDED. */
  postconditions?: ActionSubmissionCriterion[];
  /** Inverse rules if postconditions fail (saga; UnitOfWork still rolls back). */
  compensation?: ActionRule[];
  /** What the audit entry must contain. Defaults: include parameters + result. */
  auditRequirements?: {
    includeParameters?: boolean;
    includeResult?: boolean;
  };
  permissions?: string[];
  version?: number;
  status?: ActionTypeStatus;
  /** When true, apply pauses in AWAITING_APPROVAL until approve(). */
  requiresApproval?: boolean;
  approvals?: {
    required: boolean;
    /** Policy the approver must hold. Requester cannot self-approve. */
    approverPolicy?: string;
  };
}

/** FunctionType — CINÉTICO (definição; artifact bytes vivem no FunctionArtifactStore). */
export interface FunctionTypeDef {
  id: FunctionTypeId;
  displayName: string;
  inputObjectTypeIds: ObjectTypeId[];
  description?: string;
  /** Nome de invoke na API (default = id). */
  apiName?: string;
  /** SHA-256 of the immutable artifact bytes. Required to pin an execution. */
  artifactHash?: string;
  /** Monotonic Function version inside the ontology lineage. Default 1 at pin. */
  functionVersion?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
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
