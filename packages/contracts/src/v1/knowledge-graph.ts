/**
 * contracts — src/v1/knowledge-graph.ts
 * Links tipados + Knowledge Graph (Passo 19). Shape congelado.
 *
 * US20250077899A1 — knowledge graph (Object→Link→Object; hydration via mapping).
 * US 9,378,526 / US 9,621,676 / US 9,906,623 — remote object references (ticket/proxy).
 *
 * Kernel: multi-hop traversal (semântica de recursive CTE); integridade referencial;
 * link migration em nova mapping_version. Sem GUI / LLM / TypeDB / domínio vertical.
 */

import type { LinkTypeId, ObjectTypeId } from './ontology.js';
import type {
  LinkInstanceId,
  MappingVersionId,
  OntologyObjectId,
  SourceField,
} from './object-platform.js';
import type { PrincipalId } from './policy.js';
import type { VersionId } from './dataset-store.js';

export type GraphObjectId = OntologyObjectId;
export type TicketId = string;
export type LinkMigrationId = string;

/** Direção da aresta na travessia. */
export type TraverseDirection = 'outgoing' | 'incoming' | 'both';

/** Nó do grafo vivo (kernel — subset do OntologyObject). */
export interface GraphObject {
  id: GraphObjectId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  properties?: Record<string, unknown>;
  deleted?: boolean;
  /** Connector / source system that produced this object (Passo 26). */
  sourceSystem?: string;
  /** Inherited or assigned classification marking. */
  classification?: string;
  /** Provenance source ids (Passo 27 — critério de redação). */
  provenance?: string[];
  /** Per-property classification (column/property lineage). */
  propertyClassifications?: Record<string, string>;
}

/** Link tipado materializado (FK cruzada / relação). */
export interface TypedLink {
  id: LinkInstanceId;
  linkTypeId: LinkTypeId;
  sourceObjectId: GraphObjectId;
  targetObjectId: GraphObjectId;
  mappingVersionId: MappingVersionId;
  datasetVersionId?: VersionId;
  /** Dataset de origem da FK (quando cruzada entre fontes). */
  sourceDatasetId?: string;
  targetDatasetId?: string;
}

/** Spec de materialização a partir de FK física. */
export interface LinkMaterializeSpec {
  linkTypeId: LinkTypeId;
  sourceObjectTypeId: ObjectTypeId;
  targetObjectTypeId: ObjectTypeId;
  /** Campo PK no objeto fonte que aponta para PK do alvo. */
  fkField: SourceField;
  mappingVersionId: MappingVersionId;
  datasetVersionId?: VersionId;
}

export interface TraverseHop {
  depth: number;
  viaLinkId: LinkInstanceId;
  viaLinkTypeId: LinkTypeId;
  fromObjectId: GraphObjectId;
  toObjectId: GraphObjectId;
}

export interface TraverseQuery {
  startObjectId: GraphObjectId;
  /** Se omitido, qualquer LinkType. */
  linkTypeIds?: LinkTypeId[];
  maxHops: number;
  direction?: TraverseDirection;
  /** Evita ciclos (default true). */
  uniqueNodes?: boolean;
  principal?: PrincipalId;
  /**
   * Dissemination viewing level (Passo 26). When set, hops to objects
   * whose classification exceeds this level are omitted.
   */
  viewingLevel?: string;
}

export interface TraverseResult {
  startObjectId: GraphObjectId;
  nodes: GraphObject[];
  hops: TraverseHop[];
  /** Profundidade máxima alcançada. */
  maxDepthReached: number;
}

export interface IntegrityIssue {
  kind: 'dangling_source' | 'dangling_target' | 'self_loop_forbidden' | 'duplicate';
  linkId: LinkInstanceId;
  detail: string;
}

export interface IntegrityReport {
  ok: boolean;
  linkCount: number;
  objectCount: number;
  issues: IntegrityIssue[];
}

export interface LinkMigrationInput {
  fromMappingVersionId: MappingVersionId;
  toMappingVersionId: MappingVersionId;
  /**
   * Remapeamento de LinkType (quando a nova versão renomeia/substitui).
   * Default: mesmo linkTypeId.
   */
  linkTypeMap?: Record<LinkTypeId, LinkTypeId>;
  /** Se true, remove links da versão antiga após migrar. */
  dropOld?: boolean;
}

export interface LinkMigrationResult {
  migrationId: LinkMigrationId;
  migrated: number;
  dropped: number;
  skipped: number;
}

/**
 * Referência remota (US 9,378,526) — ticket opaco + proxy.
 * Resolve sob demanda; não embute o objeto inteiro.
 */
export interface RemoteObjectRef {
  ticketId: TicketId;
  objectId: GraphObjectId;
  objectTypeId: ObjectTypeId;
  createdAt: string;
}

/**
 * WHY async (ADR-0014): objects and links live in the async storage kernel.
 * A sync facade would have to detect a Promise after a write already started.
 */
export interface KnowledgeGraphStore {
  upsertObject(obj: GraphObject): Promise<void>;
  getObject(id: GraphObjectId): Promise<GraphObject | undefined>;
  listObjects(objectTypeId?: ObjectTypeId): Promise<GraphObject[]>;

  /**
   * Materializa link tipado. Falha se source/target inexistentes
   * (integridade referencial).
   */
  upsertLink(link: Omit<TypedLink, 'id'> & { id?: LinkInstanceId }): Promise<TypedLink>;
  getLink(id: LinkInstanceId): Promise<TypedLink | undefined>;
  listLinks(filter?: {
    linkTypeId?: LinkTypeId;
    mappingVersionId?: MappingVersionId;
  }): Promise<TypedLink[]>;

  /** Integridade referencial do grafo. */
  checkIntegrity(): Promise<IntegrityReport>;

  /** Travessia multi-hop (semântica de WITH RECURSIVE). */
  traverseLinks(query: TraverseQuery): Promise<TraverseResult>;

  /**
   * Gera SQL Postgres recursive CTE equivalente à query
   * (documentação / upgrade path — execução kernel é in-memory).
   */
  toRecursiveCteSql(query: TraverseQuery): string;

  /** Migração de links ao mudar mapping_version. */
  migrateLinks(input: LinkMigrationInput): Promise<LinkMigrationResult>;

  /** Remote reference: ticket → resolve. */
  createRemoteReference(objectId: GraphObjectId): Promise<RemoteObjectRef>;
  resolveRemoteReference(ticketId: TicketId): Promise<GraphObject | null>;
  /** Acesso via proxy (forward member/property). */
  accessRemote(ticketId: TicketId, property: string): Promise<unknown>;
}

export function buildGoldenTypedLink(): TypedLink {
  return {
    id: 'link-1',
    linkTypeId: 'lt.customer_of',
    sourceObjectId: 'obj-child',
    targetObjectId: 'obj-parent',
    mappingVersionId: 'mapv-1',
    datasetVersionId: 'dv-1',
  };
}

export function assertTypedLink(link: TypedLink): void {
  if (!link.id) throw new Error('TypedLink: id obrigatório');
  if (!link.linkTypeId) throw new Error('TypedLink: linkTypeId obrigatório');
  if (!link.sourceObjectId) throw new Error('TypedLink: sourceObjectId obrigatório');
  if (!link.targetObjectId) throw new Error('TypedLink: targetObjectId obrigatório');
  if (!link.mappingVersionId) throw new Error('TypedLink: mappingVersionId obrigatório');
}
