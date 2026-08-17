/**
 * contracts — src/v1/entity-resolution.ts
 * Entity Resolution API (Passos 20–21). Shape congelado.
 *
 * US 8,554,719 / US 9,501,552 / US 9,846,731 — resolving database entity information
 *   (criteria sets, linking terms, exact/fuzzy/no-conflict).
 * US 12,229,154 — Focused Probabilistic Entity Resolution
 *   (soft resolution via metadata; P(same_entity | features); thresholds).
 * US20140280252 — comparing/associating objects
 *   (slug + bin/Bloom blocking; never full O(n²)).
 * US20250165857A1 — ontology-structured ER + human feedback.
 * US 12,393,406 / US20250348288A1 — copy-detection fingerprint search.
 * US 8,788,405 / US 8,818,892 — cluster generation + review-queue ranking.
 *
 * Kernel Passo 20: normalização → blocking → scoring.
 * Passo 21: auditoria persistida + canonical merge reversível + fingerprint search.
 * Passo 22: gold set (50 pares MATCH/NO_MATCH) + métricas + fila HTTP de revisão.
 */

import type { ObjectTypeId } from './ontology.js';

export type EntityRecordId = string;
export type ResolutionRunId = string;
export type RuleVersionId = string;
export type ClusterId = string;
export type BlockKey = string;
export type MatchAuditId = string;
export type CanonicalEntityId = string;
export type SourceCanonicalLinkId = string;
export type MergeEventId = string;
export type GoldSetId = string;
export type GoldPairId = string;

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
  /** Representante canônico sugerido (merge persistido = Passo 21). */
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

/** Revisão humana sobre um par (US20250165857A1 feedback). */
export type ReviewDecision = 'confirm_match' | 'reject_match' | 'needs_review';

/** Rótulo de gold set — Passo 22. */
export type GoldLabel = 'MATCH' | 'NO_MATCH';

/** Tamanho-alvo do gold set (tasks 068–070). */
export const GOLD_SET_TARGET_SIZE = 50;

export interface MatchReview {
  decision: ReviewDecision;
  reviewer: string;
  at: string;
  note?: string;
}

export interface MatchAuditEntry {
  id: MatchAuditId;
  runId: ResolutionRunId;
  leftId: EntityRecordId;
  rightId: EntityRecordId;
  objectTypeId: ObjectTypeId;
  blockKey: BlockKey;
  score: number;
  confidence: number;
  features: ScoreFeatures;
  /** ruleVersionId / model id. */
  modelVersion: string;
  decision: MatchDecision;
  reason: string;
  review?: MatchReview;
  createdAt: string;
}

export type CanonicalLinkStatus = 'active' | 'unmerged';

export interface SourceCanonicalLink {
  id: SourceCanonicalLinkId;
  recordId: EntityRecordId;
  canonicalId: CanonicalEntityId;
  status: CanonicalLinkStatus;
  createdAt: string;
  unmergedAt?: string;
  unmergeReason?: string;
  principal?: string;
}

export interface CanonicalEntity {
  id: CanonicalEntityId;
  objectTypeId: ObjectTypeId;
  /** Membros ativos (originais NÃO são apagados). */
  memberIds: EntityRecordId[];
  displayName?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type MergeEventKind = 'merge' | 'unmerge';

export interface MergeEvent {
  id: MergeEventId;
  kind: MergeEventKind;
  canonicalId: CanonicalEntityId;
  recordIds: EntityRecordId[];
  reason?: string;
  principal?: string;
  createdAt: string;
}

export interface MergeCanonicalInput {
  objectTypeId: ObjectTypeId;
  memberIds: EntityRecordId[];
  displayName?: string;
  principal?: string;
  reason?: string;
  /** Reuse an existing canonical id (expand). */
  canonicalId?: CanonicalEntityId;
}

export interface UnmergeInput {
  canonicalId: CanonicalEntityId;
  recordId: EntityRecordId;
  principal?: string;
  reason: string;
}

export interface RecordReviewInput {
  auditId: MatchAuditId;
  decision: ReviewDecision;
  reviewer: string;
  note?: string;
}

export interface GoldPair {
  id: GoldPairId;
  leftId: EntityRecordId;
  rightId: EntityRecordId;
  label: GoldLabel;
  labeledBy: string;
  labeledAt: string;
  note?: string;
}

export interface GoldSet {
  id: GoldSetId;
  version: number;
  pairs: GoldPair[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertGoldPairInput {
  leftId: EntityRecordId;
  rightId: EntityRecordId;
  label: GoldLabel;
  labeledBy: string;
  note?: string;
  id?: GoldPairId;
}

export interface ErMetrics {
  precision: number;
  recall: number;
  f1: number;
  falseMergeRate: number;
  falseSplitRate: number;
  manualReviewRate: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  goldPairCount: number;
  greyZoneCount: number;
  /** True when false merges would contaminate the object graph. */
  falseMergeContaminatesGraph: boolean;
  /** Human-readable gate line (false-merge-rate documentado). */
  falseMergeNote: string;
}

export interface ReviewQueueItem {
  auditId: MatchAuditId;
  runId: ResolutionRunId;
  leftId: EntityRecordId;
  rightId: EntityRecordId;
  objectTypeId: ObjectTypeId;
  score: number;
  confidence: number;
  decision: MatchDecision;
  reason: string;
  rankScore: number;
  goldLabel?: GoldLabel;
  review?: MatchReview;
}

export interface ApplyFeedbackResult {
  previous: ResolutionCriteria;
  next: ResolutionCriteria;
  adjustedTerms: string[];
  goldPairCount: number;
}

export interface SubmitReviewResult {
  audit: MatchAuditEntry;
  goldPair?: GoldPair;
}

/** Fingerprint (k-gram + winnow) — US 12,393,406 / US20250348288A1 aplicado a texto de entidade. */
export interface EntityFingerprintPoint {
  hash: number;
  position: number;
}

export interface FingerprintMatch {
  recordId: EntityRecordId;
  score: number;
  positions: number[];
}

export interface ClusterScoringMetric {
  kind: 'member_count' | 'max_confidence' | 'review_pair_count' | 'match_pair_count';
  weight: number;
}

export interface ClusterScoringStrategy {
  id: string;
  metrics: ClusterScoringMetric[];
}

export interface RankedCluster {
  clusterId: ClusterId;
  score: number;
  seedId: EntityRecordId;
  memberCount: number;
}

/**
 * ER API — Passo 20 (runResolution) + Passo 21 (audit / canonical / fingerprint / rank)
 * + Passo 22 (gold set / metrics / review queue / feedback).
 */
export interface EntityResolutionEngine {
  runResolution(input: RunResolutionInput): ResolutionResult;
  getDefaultCriteria(): ResolutionCriteria;
  commitRun(result: ResolutionResult): Promise<ResolutionRunId>;
  listMatchAudit(filter?: {
    runId?: ResolutionRunId;
    decision?: MatchDecision;
  }): Promise<MatchAuditEntry[]>;
  getMatchAudit(id: MatchAuditId): Promise<MatchAuditEntry | undefined>;
  recordReview(input: RecordReviewInput): Promise<MatchAuditEntry>;
  mergeCanonical(input: MergeCanonicalInput): Promise<CanonicalEntity>;
  unmerge(input: UnmergeInput): Promise<CanonicalEntity | undefined>;
  getCanonical(id: CanonicalEntityId): Promise<CanonicalEntity | undefined>;
  listCanonicals(objectTypeId?: ObjectTypeId): Promise<CanonicalEntity[]>;
  linksForRecord(recordId: EntityRecordId): Promise<SourceCanonicalLink[]>;
  listMergeEvents(canonicalId?: CanonicalEntityId): Promise<MergeEvent[]>;
  /** Incoming vs already-known ontology entities (US20250165857A1 target list). */
  compareToTargets(
    incoming: EntityRecord,
    targets: EntityRecord[],
    criteria?: ResolutionCriteria,
  ): ResolutionResult;
  indexFingerprints(records: EntityRecord[]): Promise<void>;
  searchSimilar(query: EntityRecord): Promise<FingerprintMatch[]>;
  rankClusters(
    clusters: SoftCluster[],
    candidates: CandidatePair[],
    strategy?: ClusterScoringStrategy,
  ): RankedCluster[];
  upsertGoldPairs(pairs: UpsertGoldPairInput[]): Promise<GoldSet>;
  getGoldSet(): Promise<GoldSet>;
  evaluateMetrics(runId?: ResolutionRunId): Promise<ErMetrics>;
  listReviewQueue(runId?: ResolutionRunId): Promise<ReviewQueueItem[]>;
  submitReview(input: RecordReviewInput): Promise<SubmitReviewResult>;
  applyFeedback(): Promise<ApplyFeedbackResult>;
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

export function buildGoldenClusterScoringStrategy(): ClusterScoringStrategy {
  return {
    id: 'review_priority_v1',
    metrics: [
      { kind: 'max_confidence', weight: 0.5 },
      { kind: 'member_count', weight: 0.3 },
      { kind: 'review_pair_count', weight: 0.2 },
    ],
  };
}

export function assertMatchAuditEntry(e: MatchAuditEntry): void {
  if (!e.id) throw new Error('MatchAuditEntry: id obrigatório');
  if (!e.runId) throw new Error('MatchAuditEntry: runId obrigatório');
  if (!e.leftId || !e.rightId) throw new Error('MatchAuditEntry: leftId/rightId obrigatórios');
  if (!e.modelVersion) throw new Error('MatchAuditEntry: modelVersion obrigatório');
  if (!e.createdAt) throw new Error('MatchAuditEntry: createdAt obrigatório');
}

export function assertCanonicalEntity(c: CanonicalEntity): void {
  if (!c.id) throw new Error('CanonicalEntity: id obrigatório');
  if (!c.objectTypeId) throw new Error('CanonicalEntity: objectTypeId obrigatório');
  if (!c.memberIds?.length) throw new Error('CanonicalEntity: memberIds obrigatório');
}

export function assertGoldPair(p: GoldPair): void {
  if (!p.id) throw new Error('GoldPair: id obrigatório');
  if (!p.leftId || !p.rightId) throw new Error('GoldPair: leftId/rightId obrigatórios');
  if (p.leftId === p.rightId) throw new Error('GoldPair: leftId e rightId devem ser distintos');
  if (p.label !== 'MATCH' && p.label !== 'NO_MATCH') {
    throw new Error('GoldPair: label deve ser MATCH ou NO_MATCH');
  }
  if (!p.labeledBy) throw new Error('GoldPair: labeledBy obrigatório');
  if (!p.labeledAt) throw new Error('GoldPair: labeledAt obrigatório');
}

export function goldLabelFromReview(decision: ReviewDecision): GoldLabel | undefined {
  if (decision === 'confirm_match') return 'MATCH';
  if (decision === 'reject_match') return 'NO_MATCH';
  return undefined;
}
