/**
 * entity-resolution — src/core/types.ts
 */

import type {
  CanonicalEntity,
  CanonicalEntityId,
  EntityRecord,
  EntityRecordId,
  FingerprintMatch,
  GoldSet,
  MatchAuditEntry,
  MatchAuditId,
  MatchDecision,
  MergeCanonicalInput,
  MergeEvent,
  ObjectTypeId,
  RecordReviewInput,
  ResolutionResult,
  ResolutionRunId,
  SourceCanonicalLink,
  SqlClient,
  UnmergeInput,
  UpsertGoldPairInput,
} from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface EntityLedger {
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
  indexFingerprints(records: EntityRecord[]): Promise<void>;
  searchSimilar(query: EntityRecord): Promise<FingerprintMatch[]>;
  upsertGoldPairs(pairs: UpsertGoldPairInput[]): Promise<GoldSet>;
  getGoldSet(): Promise<GoldSet>;
}

export interface CreateEntityResolverOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Número de bins do Bloom/hash (US20140280252). Default: auto pelo corpus. */
  bloomBins?: number;
  ledger?: EntityLedger;
  sql?: SqlClient;
}
