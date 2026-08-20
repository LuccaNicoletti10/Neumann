/**
 * contracts — src/v1/object-platform.ts
 * Mapping versionado + Projetor + Object API (Passo 18). Shape congelado.
 *
 * US 8,930,897 — mapear propriedades físicas → propriedades de objetos; relacionamentos.
 * US 10,691,729 / EP3425537A1 — object platform (definição + associação + store + API).
 * US 11,816,156 — índice/mapping campo→termo (declarativo; sem NLP/NVK).
 * US 12,561,339 — query unificada sobre ontology (API filter; sem multi-DB físico).
 *
 * Regra: mapping muda = nova mapping_version. Toda leitura passa por authorize().
 */

import type { AuthorizeRequest, AuthorizeResult, PrincipalId } from './policy.js';
import type { LinkTypeId, ObjectTypeId, OntologyVersionId, PropertyTypeId } from './ontology.js';
import type { DatasetId, VersionId } from './dataset-store.js';

/** Identificadores opacos. */
export type MappingId = string;
export type MappingVersionId = string;
export type OntologyObjectId = string;
export type ObjectHistoryId = string;
export type LinkInstanceId = string;
export type ProjectionRunId = string;

/** Campo físico no dataset (coluna / path). */
export type SourceField = string;

/** Origem de uma mudança no objeto. */
export type ObjectChangeSource = 'data_source' | 'user_edit';

/** Mapeamento propriedade física → PropertyType. */
export interface PropertyMapping {
  sourceField: SourceField;
  propertyTypeId: PropertyTypeId;
  /** Transformação declarativa simples (kernel). */
  transform?: 'identity' | 'string' | 'number' | 'boolean';
}

/** Mapeamento de FK / relacionamento → LinkType. */
export interface LinkMapping {
  linkTypeId: LinkTypeId;
  /** Campo no dataset que aponta para primary key do alvo. */
  sourceField: SourceField;
  /** ObjectType alvo (deve bater com LinkType.target). */
  targetObjectTypeId: ObjectTypeId;
}

/** Snapshot imutável de um mapping dataset→ObjectType. */
export interface MappingVersion {
  id: MappingVersionId;
  mappingId: MappingId;
  versionNumber: number;
  parentVersionId?: MappingVersionId;
  createdAt: string;
  createdBy: string;
  contentHash: string;
  status: 'COMMITTED';
  datasetId: DatasetId;
  /** Ontology version contra a qual o mapping foi validado. */
  ontologyVersionId: OntologyVersionId;
  objectTypeId: ObjectTypeId;
  /** Campo(s) que formam a primary key do objeto. */
  primaryKeyFields: SourceField[];
  propertyMappings: PropertyMapping[];
  linkMappings: LinkMapping[];
}

/** Cabeçalho do mapping (ponteiro latest). */
export interface DatasetObjectMapping {
  id: MappingId;
  name: string;
  datasetId: DatasetId;
  objectTypeId: ObjectTypeId;
  createdAt: string;
  latestVersionId?: MappingVersionId;
}

/** Draft mutável até commit. */
export interface MappingDraft {
  mappingId: MappingId;
  baseVersionId?: MappingVersionId;
  ontologyVersionId: OntologyVersionId;
  objectTypeId: ObjectTypeId;
  primaryKeyFields: SourceField[];
  propertyMappings: PropertyMapping[];
  linkMappings: LinkMapping[];
}

export interface CreateMappingInput {
  name: string;
  datasetId: DatasetId;
  objectTypeId: ObjectTypeId;
  ontologyVersionId: OntologyVersionId;
  primaryKeyFields: SourceField[];
  propertyMappings: PropertyMapping[];
  linkMappings?: LinkMapping[];
  createdBy?: string;
}

export interface CommitMappingInput {
  mappingId: MappingId;
  createdBy?: string;
}

/** Instância de objeto no object store. */
export interface OntologyObject {
  id: OntologyObjectId;
  objectTypeId: ObjectTypeId;
  /** Primary key canônica (join dos campos PK). */
  primaryKey: string;
  properties: Record<PropertyTypeId, unknown>;
  /** Versão monotônica do objeto (history). */
  version: number;
  deleted: boolean;
  /** Se true, updates de data_source não sobrescrevem (regra patent). */
  createdOrEditedByUser: boolean;
  updatedAt: string;
  mappingVersionId: MappingVersionId;
  datasetVersionId: VersionId;
}

/** Entrada append-only do histórico. */
export interface ObjectHistoryEntry {
  id: ObjectHistoryId;
  objectId: OntologyObjectId;
  version: number;
  at: string;
  source: ObjectChangeSource;
  properties: Record<PropertyTypeId, unknown>;
  deleted: boolean;
  mappingVersionId: MappingVersionId;
  datasetVersionId?: VersionId;
  principal?: PrincipalId;
}

/** Provenance de um objeto (dataset + mapping + PK). */
export interface ObjectProvenance {
  objectId: OntologyObjectId;
  datasetId: DatasetId;
  datasetVersionId: VersionId;
  mappingId: MappingId;
  mappingVersionId: MappingVersionId;
  primaryKey: string;
  objectTypeId: ObjectTypeId;
  sourceFields: SourceField[];
}

/** Link materializado entre objetos. */
export interface LinkInstance {
  id: LinkInstanceId;
  linkTypeId: LinkTypeId;
  sourceObjectId: OntologyObjectId;
  targetObjectId: OntologyObjectId;
  mappingVersionId: MappingVersionId;
  datasetVersionId: VersionId;
}

/** Filtro da Object API (US 12,561,339 — query unificada, kernel). */
export interface ObjectQuery {
  objectTypeId?: ObjectTypeId;
  /** Igualdade exata em propriedades. */
  where?: Record<PropertyTypeId, unknown>;
  includeDeleted?: boolean;
  limit?: number;
}

/** Linha física de um dataset version (input do projetor). */
export interface DatasetRow {
  /** Valores por sourceField. */
  fields: Record<SourceField, unknown>;
}

export interface ProjectInput {
  mappingVersionId: MappingVersionId;
  datasetVersionId: VersionId;
  rows: DatasetRow[];
  /** Principal que dispara a projeção (audit/policy). */
  principal?: PrincipalId;
}

export interface ProjectResult {
  runId: ProjectionRunId;
  upserted: number;
  deleted: number;
  linksUpserted: number;
  objectIds: OntologyObjectId[];
}

/** Authorize injetável (Passo 16) — evita acoplar ao engine concreto. */
export type AuthorizeFn = (req: AuthorizeRequest) => AuthorizeResult;

/** Contrato ObjectPlatform (Passo 18). */
export interface ObjectPlatform {
  /** Mapping registry versionado. */
  createMapping(input: CreateMappingInput): DatasetObjectMapping;
  getMapping(mappingId: MappingId): DatasetObjectMapping | undefined;
  openMappingDraft(mappingId: MappingId): MappingDraft;
  setMappingDraft(
    mappingId: MappingId,
    draft: Omit<MappingDraft, 'mappingId' | 'baseVersionId'> | MappingDraft,
  ): void;
  commitMapping(input: CommitMappingInput): MappingVersion;
  getMappingVersion(versionId: MappingVersionId): MappingVersion | undefined;
  getLatestMappingVersion(mappingId: MappingId): MappingVersion | undefined;
  listMappingVersions(mappingId: MappingId): MappingVersion[];

  /**
   * Projetor: dataset version → objects + history + provenance.
   * WHY async (ADR-0014): the storage kernel is async in every adapter, so the
   * facade awaits it instead of detecting a Promise after the write started.
   */
  project(input: ProjectInput): Promise<ProjectResult>;

  /** User edit (vence data_source em conflitos). */
  applyUserEdit(
    objectId: OntologyObjectId,
    properties: Record<PropertyTypeId, unknown>,
    principal: PrincipalId,
  ): Promise<OntologyObject>;

  /** Object API — toda leitura via authorize. */
  getObject(
    principal: PrincipalId,
    objectId: OntologyObjectId,
    at?: number,
  ): Promise<OntologyObject | null>;
  queryObjects(principal: PrincipalId, query: ObjectQuery): Promise<OntologyObject[]>;
  traverseLinks(
    principal: PrincipalId,
    objectId: OntologyObjectId,
    linkTypeId?: LinkTypeId,
  ): Promise<OntologyObject[]>;
  getHistory(
    principal: PrincipalId,
    objectId: OntologyObjectId,
  ): Promise<ObjectHistoryEntry[] | null>;
  getProvenance(
    principal: PrincipalId,
    objectId: OntologyObjectId,
  ): Promise<ObjectProvenance | null>;
}

export function buildGoldenPropertyMapping(): PropertyMapping {
  return {
    sourceField: 'customer_name',
    propertyTypeId: 'pt.name',
    transform: 'string',
  };
}

export function assertMappingVersion(v: MappingVersion): void {
  if (!v.id) throw new Error('MappingVersion: id obrigatório');
  if (!v.datasetId) throw new Error('MappingVersion: datasetId obrigatório');
  if (!v.objectTypeId) throw new Error('MappingVersion: objectTypeId obrigatório');
  if (!Array.isArray(v.primaryKeyFields) || v.primaryKeyFields.length === 0) {
    throw new Error('MappingVersion: primaryKeyFields[] obrigatório');
  }
  if (!Array.isArray(v.propertyMappings)) {
    throw new Error('MappingVersion: propertyMappings[] obrigatório');
  }
}
