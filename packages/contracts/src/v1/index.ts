/**
 * contracts — src/v1/index.ts
 */

export {
  type CanonicalEvent,
  hashPayload,
  canonicalizeJson,
  assertCanonicalEvent,
  serializeCanonicalEvent,
  parseCanonicalEvent,
} from './canonical-event.js';

export {
  type Capability,
  type Cursor,
  type ObjectRef,
  type SourceObject,
  type SourceColumn,
  type SourceSchema,
  type HealthState,
  type HealthStatus,
  type Connector,
} from './connector.js';

export {
  type DatasetId,
  type VersionId,
  type DatasetDef,
  type Dataset,
  type CommitInput,
  type DatasetVersion,
  type VersionDiff,
  type DatasetStore,
  assertCommitInput,
  buildGoldenCommitInput,
} from './dataset-store.js';

export {
  type DeltaKind,
  type DeltaRef,
  type DeltaOp,
  type IndividualDelta,
  type CombinedDelta,
  type BaseSnapshot,
  type MinimalDeltaSet,
  buildGoldenDeltaOps,
} from './delta-tree.js';

export {
  type LogicalTimestamp,
  type RowId,
  type TxStatus,
  type SnapshotRequest,
  type SnapshotResult,
  type ReplayResult,
  type TimeTravelStore,
  buildGoldenSnapshotRequest,
} from './time-travel.js';

export {
  type IncrementalStatus,
  type IncrementalComputability,
  type TransformOpKind,
  type TransformStep,
  type TransformProgram,
  type TransformRunResult,
  buildGoldenTransformStep,
} from './transform.js';

export {
  type DatasetKind,
  type BuildStatus,
  type DependencyKind,
  type PipelineDatasetDef,
  type PipelineEdge,
  type BuildJobSpec,
  type ScheduleTickResult,
  buildGoldenPipelineEdge,
} from './pipeline-dag.js';

export {
  type QualityDimension,
  type RuleSeverity,
  type RuleActionKind,
  type QualityRule,
  type RuleCondition,
  type QualityScore,
  type QualityReport,
  type QuarantineRecord,
  type CompositeDatasetDef,
  buildGoldenQualityRule,
} from './data-quality.js';

export {
  type SandboxDenyReason,
  type SandboxPolicy,
  type SandboxIdentity,
  type SandboxAuditEvent,
  type SandboxRunResult,
  buildGoldenSandboxPolicy,
} from './sandbox.js';

export {
  type PipelineRunId,
  type DerivationProgramId,
  type LineageVersionKind,
  type PipelineRun,
  type LineageEdge,
  type LineageVersionNode,
  type CompoundLineageNode,
  type ProvenanceGraph,
  type LineageCompletenessReport,
  type LineageChangeEvent,
  type RegisterRawVersionInput,
  type RecordPipelineRunInput,
  type LineageStore,
  buildGoldenPipelineRun,
  assertPipelineRun,
} from './lineage.js';

export {
  type PrincipalId,
  type Epid,
  type PolicyNodeId,
  type ResourceId,
  type PolicyOperation,
  type AuthzDecision,
  type NodePolicyId,
  type AuthzContext,
  type AuthorizeRequest,
  type AuthorizeResult,
  type SecurityMatrixCell,
  type SecurityMatrix,
  type PolicyNode,
  type ResourcePermissions,
  type ResourceCreateSpec,
  type ResourceCreateResult,
  type PolicyEngine,
  buildGoldenAuthorizeRequest,
  assertAuthorizeResult,
} from './policy.js';

export {
  type AuditEntryId,
  type AuditMessageType,
  type AuditEntry,
  type AuditVerifyResult,
  type AuditAppendInput,
  type AuditRepository,
  type AuditLog,
  buildGoldenAuditEntry,
} from './audit.js';

export {
  type SqlQueryResult,
  type SqlClient,
  type TransactionManager,
} from './sql.js';

export {
  type OutboxInsertInput,
  type OutboxRepository,
} from './outbox.js';

export {
  type OntologyId,
  type OntologyVersionId,
  type ObjectTypeId,
  type PropertyTypeId,
  type LinkTypeId,
  type ActionTypeId,
  type FunctionTypeId,
  type OntologyLayer,
  type PropertyBaseType,
  type PropertyValidator,
  type PropertyComponent,
  type PropertyTypeDef,
  type ObjectTypeDef,
  type LinkTypeDef,
  type ActionTypeStatus,
  type ActionParameterDef,
  type ActionSubmissionCriterion,
  type ActionRule,
  type ActionSideEffect,
  type ActionTypeDef,
  type FunctionTypeDef,
  type OntologyVersion,
  type Ontology,
  type OntologyDraft,
  type CreateOntologyInput,
  type CommitOntologyInput,
  type OntologyRegistry,
  type OntologyDiff,
  buildGoldenObjectType,
  assertObjectTypeDef,
} from './ontology.js';

export {
  type ObjectSetOp,
  type PropertyValue,
  type ObjectSetFilter,
  type BaseObjectSet,
  type FilterObjectSet,
  type UnionObjectSet,
  type IntersectObjectSet,
  type SubtractObjectSet,
  type StaticObjectSet,
  type SearchAroundObjectSet,
  type ObjectSet,
  type AggregationKind,
  type ObjectSetAggregation,
  type ObjectSetLoadRequest,
  type ObjectSetAggregateRequest,
} from './object-set.js';

export {
  type ObjectRecordId,
  type LinkRecordId,
  type ObjectRecord,
  type CreateObjectInput,
  type UpdateObjectInput,
  type ListObjectsOptions,
  type LinkRecord,
  type CreateLinkInput,
  type ObjectRepository,
  type LinkRepository,
} from './object-repository.js';

export {
  type OperationalEventId,
  type OperationalEventKind,
  type OperationalEvent,
  type OperationalEventStore,
} from './operational-event.js';

export {
  type ActionExecutionId,
  type ActionExecutionStatus,
  type ActionValidateRequest,
  type ActionValidateResult,
  type ActionApplyRequest,
  type ActionApplyResult,
  type ActionExecution,
  type ActionExecutionClaimResult,
  type ActionExecutionStore,
  type ActionExecutor,
} from './action-runtime.js';

export {
  type MappingId,
  type MappingVersionId,
  type OntologyObjectId,
  type ObjectHistoryId,
  type LinkInstanceId,
  type ProjectionRunId,
  type SourceField,
  type ObjectChangeSource,
  type PropertyMapping,
  type LinkMapping,
  type MappingVersion,
  type DatasetObjectMapping,
  type MappingDraft,
  type CreateMappingInput,
  type CommitMappingInput,
  type OntologyObject,
  type ObjectHistoryEntry,
  type ObjectProvenance,
  type LinkInstance,
  type ObjectQuery,
  type DatasetRow,
  type ProjectInput,
  type ProjectResult,
  type AuthorizeFn,
  type ObjectPlatform,
  buildGoldenPropertyMapping,
  assertMappingVersion,
} from './object-platform.js';

export {
  type GraphObjectId,
  type TicketId,
  type LinkMigrationId,
  type TraverseDirection,
  type GraphObject,
  type TypedLink,
  type LinkMaterializeSpec,
  type TraverseHop,
  type TraverseQuery,
  type TraverseResult,
  type IntegrityIssue,
  type IntegrityReport,
  type LinkMigrationInput,
  type LinkMigrationResult,
  type RemoteObjectRef,
  type KnowledgeGraphStore,
  buildGoldenTypedLink,
  assertTypedLink,
} from './knowledge-graph.js';

export {
  type EntityRecordId,
  type ResolutionRunId,
  type RuleVersionId,
  type ClusterId,
  type BlockKey,
  type MatchDecision,
  type MatchingTechnique,
  type EntityRecord,
  type NormalizedFields,
  type NormalizedRecord,
  type LinkingTerm,
  type ResolutionCriteria,
  type ScoreFeatures,
  type CandidatePair,
  type SoftCluster,
  type ResolutionStats,
  type ResolutionResult,
  type RunResolutionInput,
  type EntityResolutionEngine,
  buildGoldenEntityRecord,
  buildGoldenCriteria,
  assertEntityRecord,
  assertResolutionCriteria,
} from './entity-resolution.js';
