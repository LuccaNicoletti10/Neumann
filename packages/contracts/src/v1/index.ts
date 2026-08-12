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
