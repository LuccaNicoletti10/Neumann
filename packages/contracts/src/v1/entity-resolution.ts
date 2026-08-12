/**
 * contracts — src/v1/entity-resolution.ts
 * Entity Resolution API (Passo 20). Shape congelado.
 *
 * US 8,554,719 / US 9,501,552 / US 9,846,731 — resolving database entity information
 *   (criteria sets, linking terms, exact/fuzzy/no-conflict).
 * US 12,229,154 — Focused Probabilistic Entity Resolution
 *   (soft resolution via metadata; P(same_entity | features); thresholds).
 * US20140280252 — comparing/associating objects
 *   (slug + bin/Bloom blocking; never full O(n²)).
 *
 * Kernel Passo 20: normalização → blocking → scoring.
 * Persistência auditável / canonical merge / gold set = Passos 21–22.
 */

import type { ObjectTypeId } from './ontology.js';

export type EntityRecordId = string;
export type ResolutionRunId = string;
export type RuleVersionId = string;
export type ClusterId = string;
export type BlockKey = string;

/** Decisão do scorer (thresholds configuráveis). */
export type MatchDecision = 'match' | 'no_match' | 'review';

/** Técnica de correspondência por linking term (US 9,501,552 / US 9,846,731). */
export type MatchingTechnique = 'exact_match' | 'fuzzy_match' | 'no_conflicts';

/** Registro entrante (fonte) a resolver. */
export interface EntityRecord {
  id: EntityRecordId;
  /** Só compara com o mesmo ObjectType (US20140280252 — tipos compatíveis). */
  objectTypeId: ObjectTypeId;
  sourceSystem?: string;
  properties: Record<string, unknown>;
}

/** Campos canônicos após normalização. */
export interface NormalizedFields {
  name?: string;
  document?: string;
  email?: string;
  phone?: string;
  city?: string;
  [key: string]: string | undefined;
}

export interface NormalizedRecord {
  recordId: EntityRecordId;
  objectTypeId: ObjectTypeId;
  sourceSystem?: string;
  fields: NormalizedFields;
  /** Slug identificador (props concatenadas) — US20140280252. */
  slug: string;
  /** Chaves de bloco (exact + nome). Comparação só dentro do bloco. */
  blockKeys: BlockKey[];
}

/** Termo de ligação: propriedade + técnica + peso. */
export interface LinkingTerm {
  property: keyof NormalizedFields | string;
  technique: MatchingTechnique;
  /** Peso no score [0, 1]. */
  weight: number;
}

export interface ResolutionCriteria {
  ruleVersionId: RuleVersionId;
  linkingTerms: LinkingTerm[];
  /** Filtro de tipo alvo (US 9,501,552 target filter). */
  targetObjectTypeIds?: ObjectTypeId[];
  thresholds: {
    /** score >= match → MATCH */
    match: number;
    /** score < noMatch → NO_MATCH; entre noMatch e match → REVIEW */
    noMatch: number;
  };
}

export interface ScoreFeatures {
  sharedExactKeys: string[];
  propertyScores: Record<string, number>;
  nameSimilarity?: number;
  documentEqual?: boolean;
  emailEqual?: boolean;
  phoneEqual?: boolean;
}

export interface CandidatePair {
  leftId: EntityRecordId;
  rightId: EntityRecordId;
  objectTypeId: ObjectTypeId;
  blockKey: BlockKey;
  score: number;
  /** P(same_entity | features) — US 12,229,154 (aqui = score normalizado). */
  confidence: number;
  features: ScoreFeatures;
  decision: MatchDecision;
  reason: string;
  ruleVersionId: RuleVersionId;
}

/** Soft resolution: cluster sem destruir originais (US 12,229,154 metadata). */
export interface SoftCluster {
  clusterId: ClusterId;
  objectTypeId: ObjectTypeId;
  /** IDs dos registros associados (originais preservados). */
  memberIds: EntityRecordId[];
  /** Representante canônico sugerido (ainda não merge persistido — Passo 21). */
  suggestedCanonicalId: EntityRecordId;
  /** Label derivado (ex.: nome normalizado). */
  displayName?: string;
}

export interface ResolutionStats {
  inputCount: number;
  normalizedCount: number;
  blockCount: number;
  /** Pares comparados (só dentro de blocos). */
  comparisons: number;
  /** Prova T3.6: se fizesse O(n²) seria n*(n-1)/2. */
  fullCartesianPairs: number;
  matchCount: number;
  reviewCount: number;
  noMatchCount: number;
  clusterCount: number;
}

export interface ResolutionResult {
  runId: ResolutionRunId;
  ruleVersionId: RuleVersionId;
  normalized: NormalizedRecord[];
  candidates: CandidatePair[];
  clusters: SoftCluster[];
  stats: ResolutionStats;
}

export interface RunResolutionInput {
  records: EntityRecord[];
  criteria?: ResolutionCriteria;
}

/**
 * ER API (Passo 20) — runResolution.
 * getMatches / submitReview / getMetrics → Passos 21–22.
 */
export interface EntityResolutionEngine {
  runResolution(input: RunResolutionInput): ResolutionResult;
  getDefaultCriteria(): ResolutionCriteria;
}

export function buildGoldenEntityRecord(): EntityRecord {
  return {
    id: 'rec-acme-a',
    objectTypeId: 'ot.customer',
    sourceSystem: 'crm-a',
    properties: {
      name: 'ACME LTDA',
      document: '12.345.678/0001-90',
      email: 'Contato@ACME.com.br',
      city: 'São Paulo',
    },
  };
}

export function buildGoldenCriteria(): ResolutionCriteria {
  return {
    ruleVersionId: 'rules-v1',
    linkingTerms: [
      { property: 'document', technique: 'exact_match', weight: 1.0 },
      { property: 'email', technique: 'exact_match', weight: 0.85 },
      { property: 'phone', technique: 'exact_match', weight: 0.7 },
      { property: 'name', technique: 'fuzzy_match', weight: 0.8 },
      { property: 'city', technique: 'exact_match', weight: 0.2 },
    ],
    targetObjectTypeIds: ['ot.customer'],
    thresholds: { match: 0.75, noMatch: 0.35 },
  };
}

export function assertEntityRecord(rec: EntityRecord): void {
  if (!rec.id) throw new Error('EntityRecord: id obrigatório');
  if (!rec.objectTypeId) throw new Error('EntityRecord: objectTypeId obrigatório');
  if (!rec.properties || typeof rec.properties !== 'object') {
    throw new Error('EntityRecord: properties obrigatório');
  }
}

export function assertResolutionCriteria(c: ResolutionCriteria): void {
  if (!c.ruleVersionId) throw new Error('ResolutionCriteria: ruleVersionId obrigatório');
  if (!c.linkingTerms?.length) throw new Error('ResolutionCriteria: linkingTerms obrigatório');
  if (!(c.thresholds.match > c.thresholds.noMatch)) {
    throw new Error('ResolutionCriteria: thresholds.match deve ser > noMatch');
  }
}
