/**
 * ProjectionWriter — ingestion deep module.
 *
 * Pipeline (one generation, one transaction):
 *   authorize projection capability
 *   → validate ontology/schema
 *   → claim sourceEventId
 *   → object/link (history is written by the governed repository, not here)
 *   → operational event + outbox
 *   → complete ledger
 *
 * WHY claim-before-write: a replay must not create a second object row.
 * WHY one UnitOfWork: a throw after repository write rolls back ledger+effects.
 */

import type {
  AuditLog,
  AuthorizeFn,
  DeleteProjectedLinkCommand,
  DeleteProjectedObjectCommand,
  LinkRepository,
  MigrateObjectCommand,
  ObjectRecord,
  ObjectRepository,
  OntologyRegistry,
  OperationalEventStore,
  OutboxRepository,
  ProjectLinkCommand,
  ProjectObjectCommand,
  ProjectionBatchCommand,
  ProjectionBatchResult,
  ProjectionOperation,
  ProjectionResult,
  ProjectionWriter,
} from 'contracts';
import { allowsMutation } from 'contracts';

import { createSystemClock } from './determinism.js';
import { hashCanonical } from './hash.js';
import {
  ObjectNotFoundError,
  OntologyValidationError,
  ProjectionConflictError,
  ProjectionDeniedError,
  VersionConflictError,
} from './errors.js';
import { isMemoryCheckpoint, type MemoryCheckpoint } from './memory-checkpoint.js';
import { createSnapshotUnitOfWork } from './memory-transaction-boundary.js';
import {
  createOntologyVersionPolicy,
  type OntologyVersionPolicy,
} from './ontology-version-policy.js';
import type { ProjectionLedger, ProjectionLedgerRecord } from './projection-ledger.js';
import { buildProjectionRequestIdentity, normaliseEffect } from './projection-request-identity.js';
import type { Clock } from './types.js';

export interface ProjectionStores {
  objects: ObjectRepository;
  links: LinkRepository;
  events: OperationalEventStore;
  ledger: ProjectionLedger;
  audit?: AuditLog;
  outbox?: OutboxRepository;
}

export interface ProjectionUnitOfWork {
  run<T>(fn: (stores: ProjectionStores) => Promise<T>): Promise<T>;
}

export interface CreateProjectionWriterOptions {
  objects: ObjectRepository;
  links: LinkRepository;
  events: OperationalEventStore;
  ledger: ProjectionLedger;
  /**
   * Capability resource from ResourceIds.admin('projection').
   * Callers must not concatenate schemes.
   */
  resourceId: string;
  authorize: AuthorizeFn;
  ontology?: OntologyRegistry;
  /**
   * Version authority. Derived from `ontology` when omitted.
   * WHY: the batch pin must come from the same module the governed repository
   * asks, otherwise a schema published mid-batch is seen by only one of them.
   */
  versionPolicy?: OntologyVersionPolicy;
  audit?: AuditLog;
  outbox?: OutboxRepository;
  /**
   * Required unless every listed store implements MemoryCheckpoint (snapshot UoW).
   * PG always passes a SQL transaction UoW. Compensation is not a substitute.
   */
  unitOfWork?: ProjectionUnitOfWork;
  clock?: Clock;
}

function resolveProjectionUnitOfWork(
  opts: CreateProjectionWriterOptions,
  defaultStores: ProjectionStores,
): ProjectionUnitOfWork {
  if (opts.unitOfWork) return opts.unitOfWork;
  const required = [opts.objects, opts.links, opts.events, opts.ledger];
  if (!required.every(isMemoryCheckpoint)) {
    throw new Error(
      'ProjectionWriter requires unitOfWork (memory stores must be checkpointable)',
    );
  }
  const checkpoints: MemoryCheckpoint[] = [];
  for (const store of required) {
    if (isMemoryCheckpoint(store)) checkpoints.push(store);
  }
  if (isMemoryCheckpoint(opts.outbox)) checkpoints.push(opts.outbox);
  return createSnapshotUnitOfWork(checkpoints, () => defaultStores);
}

async function asValue<T>(v: T | Promise<T>): Promise<T> {
  return await v;
}

/**
 * Ledger namespace for declared migrations.
 * WHY a fixed source: migration identity is the idempotencyKey, and it must not
 * collide with a connector that happens to reuse the same event id.
 */
const MIGRATION_SOURCE = 'ontology-migration';

function payloadHash(value: unknown): string {
  return hashCanonical(value);
}

function replayOrConflict(
  record: ProjectionLedgerRecord,
  hash: string,
): ProjectionResult {
  if (record.payloadHash !== hash) {
    throw new ProjectionConflictError(
      `projection conflict: sourceEventId ${record.sourceEventId} already applied with a different payload`,
    );
  }
  return { ...record.result, status: 'replayed' };
}

/**
 * Ingestion port. Not mounted on `/api/v2`.
 *
 * @throws {ProjectionDeniedError} policy deny — no reads, no writes
 * @throws {ProjectionConflictError} same sourceEventId, different payload
 * @throws {VersionConflictError} stale expectedVersion
 */
export function createProjectionWriter(opts: CreateProjectionWriterOptions): ProjectionWriter {
  if (!opts.authorize) {
    throw new Error('ProjectionWriter requires authorize (fail-closed)');
  }
  if (!opts.resourceId) {
    throw new Error('ProjectionWriter requires resourceId from ResourceIds');
  }
  const clock = opts.clock ?? createSystemClock();
  const defaultStores: ProjectionStores = {
    objects: opts.objects,
    links: opts.links,
    events: opts.events,
    ledger: opts.ledger,
    audit: opts.audit,
    outbox: opts.outbox,
  };
  const unitOfWork = resolveProjectionUnitOfWork(opts, defaultStores);
  const versionPolicy =
    opts.versionPolicy ??
    (opts.ontology ? createOntologyVersionPolicy({ registry: opts.ontology }) : undefined);

  async function run<T>(fn: (stores: ProjectionStores) => Promise<T>): Promise<T> {
    return unitOfWork.run(fn);
  }

  function authorize(principal: string, operation: 'create' | 'modify' | 'delete'): void {
    const decision = opts.authorize({
      principal,
      resource: opts.resourceId,
      operation,
    });
    if (!allowsMutation(decision)) {
      throw new ProjectionDeniedError();
    }
  }

  /**
   * Pin the ontology version once per operation, through the single authority.
   * WHY: one snapshot per transaction prevents a schema change mid-batch from
   * making some effects valid and others invalid inside the same transaction.
   */
  async function pinOntologyVersion(ontologyId: string, requested?: string) {
    if (!versionPolicy) return undefined;
    const pinned = await versionPolicy.pin({ kind: 'create', ontologyId, requested });
    return pinned.version;
  }

  /**
   * The pinned version decides which object types exist for this operation.
   *
   * WHY only existence: property validation belongs to the version stamped on
   * the record, which is known only once the row is read. The governed
   * repository owns it (ADR-0014). Validating properties here against the pin
   * would apply a newer schema to an older object — an implicit migration.
   */
  function requireObjectTypeInVersion(
    version: NonNullable<Awaited<ReturnType<typeof pinOntologyVersion>>>,
    objectTypeId: string,
    // Track object types created earlier in the same batch (endpoint existence).
    createdInBatch?: Set<string>,
  ): void {
    if (version.objectTypes[objectTypeId]) return;
    // WHY: an objectTypeId created earlier in the same batch is valid even if the
    // version snapshot predates it — callers must commit the ontology first,
    // but batch-internal forward references are supported via createdInBatch.
    if (!createdInBatch?.has(objectTypeId)) {
      throw new OntologyValidationError([`unknown object type "${objectTypeId}"`]);
    }
  }

  function validateLinkTypeAgainstVersion(
    version: NonNullable<Awaited<ReturnType<typeof pinOntologyVersion>>>,
    linkTypeId: string,
    sourceObjectTypeId?: string,
    targetObjectTypeId?: string,
    callerCardinality?: string,
    createdInBatch?: Set<string>,
  ): string | undefined {
    const linkDef = version.linkTypes[linkTypeId];
    if (!linkDef) {
      throw new OntologyValidationError([`unknown link type "${linkTypeId}"`]);
    }
    // WHY: source and target types must match the LinkType definition.
    if (sourceObjectTypeId && linkDef.sourceObjectTypeId && linkDef.sourceObjectTypeId !== sourceObjectTypeId) {
      throw new OntologyValidationError([
        `source type "${sourceObjectTypeId}" does not match LinkType "${linkTypeId}" expected "${linkDef.sourceObjectTypeId}"`,
      ]);
    }
    if (targetObjectTypeId && linkDef.targetObjectTypeId && linkDef.targetObjectTypeId !== targetObjectTypeId) {
      throw new OntologyValidationError([
        `target type "${targetObjectTypeId}" does not match LinkType "${linkTypeId}" expected "${linkDef.targetObjectTypeId}"`,
      ]);
    }
    // WHY: endpoint object types must exist in the ontology or be created earlier in the batch.
    if (linkDef.sourceObjectTypeId && !version.objectTypes[linkDef.sourceObjectTypeId] && !createdInBatch?.has(linkDef.sourceObjectTypeId)) {
      throw new OntologyValidationError([
        `LinkType "${linkTypeId}" source object type "${linkDef.sourceObjectTypeId}" does not exist in ontology`,
      ]);
    }
    if (linkDef.targetObjectTypeId && !version.objectTypes[linkDef.targetObjectTypeId] && !createdInBatch?.has(linkDef.targetObjectTypeId)) {
      throw new OntologyValidationError([
        `LinkType "${linkTypeId}" target object type "${linkDef.targetObjectTypeId}" does not exist in ontology`,
      ]);
    }
    // WHY: cardinality must come from the ontology, not from the caller.
    const schemaCardinality = (linkDef as { cardinality?: string }).cardinality;
    if (schemaCardinality && callerCardinality && callerCardinality !== schemaCardinality) {
      throw new OntologyValidationError([
        `cardinality "${callerCardinality}" contradicts ontology schema "${schemaCardinality}" for link type "${linkTypeId}"`,
      ]);
    }
    return schemaCardinality ?? callerCardinality;
  }

  async function validateObjectType(ontologyId: string, objectTypeId: string): Promise<void> {
    if (!opts.ontology) return;
    const version = await pinOntologyVersion(ontologyId);
    if (!version) return;
    requireObjectTypeInVersion(version, objectTypeId);
  }

  async function validateLinkType(
    ontologyId: string,
    linkTypeId: string,
    sourceObjectTypeId?: string,
    targetObjectTypeId?: string,
    callerCardinality?: string,
  ): Promise<string | undefined> {
    if (!opts.ontology) return callerCardinality;
    const version = await pinOntologyVersion(ontologyId);
    if (!version) return callerCardinality;
    return validateLinkTypeAgainstVersion(version, linkTypeId, sourceObjectTypeId, targetObjectTypeId, callerCardinality);
  }

  async function emit(
    stores: ProjectionStores,
    result: ProjectionResult,
    principal: string,
    kind: 'ObjectCreated' | 'ObjectModified' | 'ObjectDeleted' | 'LinkCreated' | 'LinkDeleted',
  ): Promise<void> {
    await stores.events.append({
      kind,
      ontologyId: result.ontologyId,
      principal,
      objectId: result.object?.id,
      objectTypeId: result.object?.objectTypeId,
      primaryKey: result.object?.primaryKey,
      linkId: result.link?.id,
      linkTypeId: result.link?.linkTypeId,
      payload: { source: result.source, sourceEventId: result.sourceEventId },
    });
    if (stores.outbox) {
      await stores.outbox.insert({
        topic: 'projection.applied',
        key: `${result.source}+${result.ontologyId}+${result.sourceEventId}`,
        payload: {
          operation: result.operation,
          source: result.source,
          sourceEventId: result.sourceEventId,
        },
        principal,
        tenantId: 'default',
        traceId: result.sourceEventId,
      });
    }
    if (stores.audit) {
      await stores.audit.append(
        JSON.stringify({
          kind: 'ProjectionApplied',
          operation: result.operation,
          sourceEventId: result.sourceEventId,
        }),
        { source: result.source, ontologyId: result.ontologyId },
        principal,
      );
    }
  }

  async function finish(
    stores: ProjectionStores,
    claim: ProjectionLedgerRecord,
    hash: string,
    result: ProjectionResult,
    principal: string,
    kind: 'ObjectCreated' | 'ObjectModified' | 'ObjectDeleted' | 'LinkCreated' | 'LinkDeleted',
  ): Promise<ProjectionResult> {
    // WHY: no compensating delete/abandon. A throw here aborts the UnitOfWork.
    await emit(stores, result, principal, kind);
    await stores.ledger.complete({ ...claim, payloadHash: hash, result });
    return result;
  }

  return {
    async projectObject(cmd: ProjectObjectCommand): Promise<ProjectionResult> {
      authorize(cmd.principal, 'create');
      const pinned = await pinOntologyVersion(cmd.ontologyId);
      if (pinned) requireObjectTypeInVersion(pinned, cmd.objectTypeId);
      const hash = payloadHash({
        operation: 'project_object' satisfies ProjectionOperation,
        objectTypeId: cmd.objectTypeId,
        primaryKey: cmd.primaryKey,
        properties: cmd.properties,
        source: cmd.source,
      });
      return run(async (stores) => {
        const { claimed, record } = await stores.ledger.claim({
          source: cmd.source,
          ontologyId: cmd.ontologyId,
          sourceEventId: cmd.sourceEventId,
          payloadHash: hash,
          operation: 'project_object',
        });
        if (!claimed) return replayOrConflict(record, hash);

        const previous = await asValue(
          stores.objects.get(cmd.ontologyId, cmd.objectTypeId, cmd.primaryKey),
        );
        let object: ObjectRecord;
        let historyOp: 'create' | 'update';
        if (!previous) {
          object = await asValue(
            stores.objects.create({
              ontologyId: cmd.ontologyId,
              ontologyVersionId: pinned?.id,
              objectTypeId: cmd.objectTypeId,
              primaryKey: cmd.primaryKey,
              properties: cmd.properties,
              source: cmd.source,
              provenance: {
                ...(cmd.provenance ?? {}),
                sourceEventId: cmd.sourceEventId,
                observedAt: cmd.observedAt ?? clock(),
              },
            }),
          );
          historyOp = 'create';
        } else {
          if (cmd.expectedVersion != null && previous.version !== cmd.expectedVersion) {
            throw new VersionConflictError(
              `version conflict: expected ${cmd.expectedVersion}, got ${previous.version}`,
              {
                expectedVersion: cmd.expectedVersion,
                actualVersion: previous.version,
              },
            );
          }
          object = await asValue(
            stores.objects.update(cmd.ontologyId, cmd.objectTypeId, cmd.primaryKey, {
              properties: cmd.properties,
              mode: 'replace',
              expectedVersion: cmd.expectedVersion ?? previous.version,
              ontologyVersionId: pinned?.id,
            }),
          );
          historyOp = 'update';
        }
        const result: ProjectionResult = {
          status: 'applied',
          operation: 'project_object',
          source: cmd.source,
          sourceEventId: cmd.sourceEventId,
          ontologyId: cmd.ontologyId,
          object,
        };
        return finish(
          stores,
          record,
          hash,
          result,
          cmd.principal,
          historyOp === 'create' ? 'ObjectCreated' : 'ObjectModified',
        );
      });
    },

    async deleteProjectedObject(cmd: DeleteProjectedObjectCommand): Promise<ProjectionResult> {
      authorize(cmd.principal, 'delete');
      await validateObjectType(cmd.ontologyId, cmd.objectTypeId);
      const hash = payloadHash({
        operation: 'delete_object' satisfies ProjectionOperation,
        objectTypeId: cmd.objectTypeId,
        primaryKey: cmd.primaryKey,
        source: cmd.source,
      });
      return run(async (stores) => {
        const { claimed, record } = await stores.ledger.claim({
          source: cmd.source,
          ontologyId: cmd.ontologyId,
          sourceEventId: cmd.sourceEventId,
          payloadHash: hash,
          operation: 'delete_object',
        });
        if (!claimed) return replayOrConflict(record, hash);
        const deleted = await asValue(
          stores.objects.delete(cmd.ontologyId, cmd.objectTypeId, cmd.primaryKey, {
            expectedVersion: cmd.expectedVersion,
          }),
        );
        const result: ProjectionResult = {
          status: 'applied',
          operation: 'delete_object',
          source: cmd.source,
          sourceEventId: cmd.sourceEventId,
          ontologyId: cmd.ontologyId,
          object: deleted,
          deleted: true,
        };
        return finish(stores, record, hash, result, cmd.principal, 'ObjectDeleted');
      });
    },

    async projectLink(cmd: ProjectLinkCommand): Promise<ProjectionResult> {
      authorize(cmd.principal, 'create');
      await validateLinkType(cmd.ontologyId, cmd.linkTypeId, cmd.sourceObjectTypeId, cmd.targetObjectTypeId, cmd.cardinality);
      const hash = payloadHash({
        operation: 'project_link' satisfies ProjectionOperation,
        linkTypeId: cmd.linkTypeId,
        sourceObjectTypeId: cmd.sourceObjectTypeId,
        sourcePrimaryKey: cmd.sourcePrimaryKey,
        targetObjectTypeId: cmd.targetObjectTypeId,
        targetPrimaryKey: cmd.targetPrimaryKey,
        source: cmd.source,
      });
      return run(async (stores) => {
        const { claimed, record } = await stores.ledger.claim({
          source: cmd.source,
          ontologyId: cmd.ontologyId,
          sourceEventId: cmd.sourceEventId,
          payloadHash: hash,
          operation: 'project_link',
        });
        if (!claimed) return replayOrConflict(record, hash);
        const link = await asValue(
          stores.links.create({
            ontologyId: cmd.ontologyId,
            linkTypeId: cmd.linkTypeId,
            sourceObjectTypeId: cmd.sourceObjectTypeId,
            sourcePrimaryKey: cmd.sourcePrimaryKey,
            targetObjectTypeId: cmd.targetObjectTypeId,
            targetPrimaryKey: cmd.targetPrimaryKey,
            cardinality: cmd.cardinality,
            source: cmd.source,
            principal: cmd.principal,
            provenance: {
              ...(cmd.provenance ?? {}),
              sourceEventId: cmd.sourceEventId,
              observedAt: cmd.observedAt ?? clock(),
            },
          }),
        );
        const result: ProjectionResult = {
          status: 'applied',
          operation: 'project_link',
          source: cmd.source,
          sourceEventId: cmd.sourceEventId,
          ontologyId: cmd.ontologyId,
          link,
        };
        return finish(stores, record, hash, result, cmd.principal, 'LinkCreated');
      });
    },

    async deleteProjectedLink(cmd: DeleteProjectedLinkCommand): Promise<ProjectionResult> {
      authorize(cmd.principal, 'delete');
      await validateLinkType(cmd.ontologyId, cmd.linkTypeId, cmd.sourceObjectTypeId, cmd.targetObjectTypeId);
      const hash = payloadHash({
        operation: 'delete_link' satisfies ProjectionOperation,
        linkTypeId: cmd.linkTypeId,
        sourceObjectTypeId: cmd.sourceObjectTypeId,
        sourcePrimaryKey: cmd.sourcePrimaryKey,
        targetObjectTypeId: cmd.targetObjectTypeId,
        targetPrimaryKey: cmd.targetPrimaryKey,
        source: cmd.source,
      });
      return run(async (stores) => {
        const { claimed, record } = await stores.ledger.claim({
          source: cmd.source,
          ontologyId: cmd.ontologyId,
          sourceEventId: cmd.sourceEventId,
          payloadHash: hash,
          operation: 'delete_link',
        });
        if (!claimed) return replayOrConflict(record, hash);
        const deleted = await asValue(
          stores.links.delete(
            cmd.ontologyId,
            cmd.linkTypeId,
            cmd.sourceObjectTypeId,
            cmd.sourcePrimaryKey,
            cmd.targetObjectTypeId,
            cmd.targetPrimaryKey,
          ),
        );
        const result: ProjectionResult = {
          status: 'applied',
          operation: 'delete_link',
          source: cmd.source,
          sourceEventId: cmd.sourceEventId,
          ontologyId: cmd.ontologyId,
          deleted: Boolean(deleted),
        };
        return finish(stores, record, hash, result, cmd.principal, 'LinkDeleted');
      });
    },

    async migrateObject(cmd: MigrateObjectCommand): Promise<ProjectionResult> {
      // WHY 'modify' and not 'create': migration rewrites an existing object.
      authorize(cmd.principal, 'modify');
      if (!versionPolicy) {
        throw new Error('migrateObject requires an ontology version authority');
      }
      if (cmd.fromVersionId === cmd.toVersionId) {
        throw new OntologyValidationError([
          `migration source and target are the same version (${cmd.fromVersionId})`,
        ]);
      }
      const hash = payloadHash({
        operation: 'migrate_object' satisfies ProjectionOperation,
        objectTypeId: cmd.objectTypeId,
        primaryKey: cmd.primaryKey,
        fromVersionId: cmd.fromVersionId,
        toVersionId: cmd.toVersionId,
        expectedObjectVersion: cmd.expectedObjectVersion,
        transformedProperties: cmd.transformedProperties,
      });
      return run(async (stores) => {
        const { claimed, record } = await stores.ledger.claim({
          source: MIGRATION_SOURCE,
          ontologyId: cmd.ontologyId,
          sourceEventId: cmd.idempotencyKey,
          payloadHash: hash,
          operation: 'migrate_object',
        });
        if (!claimed) return replayOrConflict(record, hash);

        const before = await asValue(
          stores.objects.get(cmd.ontologyId, cmd.objectTypeId, cmd.primaryKey),
        );
        if (!before) {
          throw new ObjectNotFoundError(
            `object not found: ${cmd.objectTypeId}/${cmd.primaryKey}`,
          );
        }
        if (before.version !== cmd.expectedObjectVersion) {
          throw new VersionConflictError(
            `version conflict: expected ${cmd.expectedObjectVersion}, got ${before.version}`,
            {
              expectedVersion: cmd.expectedObjectVersion,
              actualVersion: before.version,
            },
          );
        }
        // The governed repository validates against toVersionId and stamps it.
        const object = await asValue(
          stores.objects.update(cmd.ontologyId, cmd.objectTypeId, cmd.primaryKey, {
            properties: cmd.transformedProperties,
            mode: 'replace',
            expectedVersion: cmd.expectedObjectVersion,
            ontologyVersionId: cmd.fromVersionId,
            migrateToOntologyVersionId: cmd.toVersionId,
            provenance: {
              ...(cmd.provenance ?? {}),
              migratedFromOntologyVersionId: cmd.fromVersionId,
              migratedToOntologyVersionId: cmd.toVersionId,
              observedAt: cmd.observedAt ?? clock(),
            },
          }),
        );
        const result: ProjectionResult = {
          status: 'applied',
          operation: 'migrate_object',
          source: MIGRATION_SOURCE,
          sourceEventId: cmd.idempotencyKey,
          ontologyId: cmd.ontologyId,
          object,
        };
        return finish(stores, record, hash, result, cmd.principal, 'ObjectModified');
      });
    },

    async projectBatch(cmd: ProjectionBatchCommand): Promise<ProjectionBatchResult> {
      // WHY: validate auth and ontology before claiming the ledger key so a deny
      // or schema error never marks the sourceEventId as claimed. One pinned
      // version per batch — schema cannot shift mid-transaction.
      authorize(cmd.principal, 'create');
      const pinnedVersion = await pinOntologyVersion(cmd.ontologyId, cmd.ontologyVersionId);
      const createdInBatch = new Set<string>();
      for (const effect of cmd.effects) {
        if (effect.kind === 'project_object' || effect.kind === 'delete_object') {
          if (pinnedVersion) {
            requireObjectTypeInVersion(pinnedVersion, effect.cmd.objectTypeId, createdInBatch);
          }
          // Track so subsequent link effects can reference this object type.
          createdInBatch.add(effect.cmd.objectTypeId);
        } else if (effect.kind === 'project_link') {
          if (pinnedVersion) {
            validateLinkTypeAgainstVersion(
              pinnedVersion,
              effect.cmd.linkTypeId,
              effect.cmd.sourceObjectTypeId,
              effect.cmd.targetObjectTypeId,
              effect.cmd.cardinality,
              createdInBatch,
            );
          }
        } else {
          if (pinnedVersion) {
            validateLinkTypeAgainstVersion(
              pinnedVersion,
              effect.cmd.linkTypeId,
              effect.cmd.sourceObjectTypeId,
              effect.cmd.targetObjectTypeId,
              undefined,
              createdInBatch,
            );
          }
        }
      }

      // WHY: the batch hash covers every field including the ordered effect list with
      // all fields (cardinality, source/target types, endpoints) flattened at the top
      // level. Hiding any field inside an opaque `cmd` blob would allow a divergent
      // retry to silently succeed.
      const identity = buildProjectionRequestIdentity({
        source: cmd.source,
        ontologyId: cmd.ontologyId,
        ontologyVersionId: cmd.ontologyVersionId,
        sourceEventId: cmd.sourceEventId,
        principal: cmd.principal,
        observedAt: cmd.observedAt,
        provenance: cmd.provenance,
        effects: cmd.effects.map((e) => normaliseEffect(e, cmd.principal)),
      });
      const batchHash = identity.batchHash;
      const batchOperation: ProjectionOperation = 'project_object'; // sentinel; batch key is per sourceEventId

      return run(async (stores) => {
        const { claimed, record } = await stores.ledger.claim({
          source: cmd.source,
          ontologyId: cmd.ontologyId,
          sourceEventId: cmd.sourceEventId,
          payloadHash: batchHash,
          operation: batchOperation,
        });

        if (!claimed) {
          // Replay or conflict.
          if (record.payloadHash !== batchHash) {
            throw new ProjectionConflictError(
              `projection conflict: sourceEventId ${cmd.sourceEventId} already applied with a different batch payload`,
            );
          }
          // Replay: reconstruct per-effect results from the stored batch result.
          const stored = record.result as { results?: ProjectionResult[] } | undefined;
          const storedResults: ProjectionResult[] = stored?.results ?? cmd.effects.map((_) => ({
            status: 'replayed' as const,
            operation: 'project_object' as const,
            source: cmd.source,
            sourceEventId: cmd.sourceEventId,
            ontologyId: cmd.ontologyId,
          }));
          return { status: 'replayed', results: storedResults };
        }

        // Apply each effect inside the same transaction.
        const results: ProjectionResult[] = [];
        for (const effect of cmd.effects) {
          if (effect.kind === 'project_object') {
            const c = effect.cmd;
            const previous = await asValue(stores.objects.get(cmd.ontologyId, c.objectTypeId, c.primaryKey));
            let object: ObjectRecord;
            let historyOp: 'create' | 'update';
            if (!previous) {
              object = await asValue(stores.objects.create({
                ontologyId: cmd.ontologyId,
                ontologyVersionId: pinnedVersion?.id,
                objectTypeId: c.objectTypeId,
                primaryKey: c.primaryKey,
                properties: c.properties,
                source: cmd.source,
                provenance: {
                  ...(cmd.provenance ?? {}),
                  ...(c.provenance ?? {}),
                  sourceEventId: cmd.sourceEventId,
                  observedAt: cmd.observedAt ?? clock(),
                },
              }));
              historyOp = 'create';
            } else {
              if (c.expectedVersion != null && previous.version !== c.expectedVersion) {
                throw new VersionConflictError(
                  `version conflict: expected ${c.expectedVersion}, got ${previous.version}`,
                  { expectedVersion: c.expectedVersion, actualVersion: previous.version },
                );
              }
              object = await asValue(stores.objects.update(cmd.ontologyId, c.objectTypeId, c.primaryKey, {
                properties: c.properties,
                mode: 'replace',
                expectedVersion: c.expectedVersion ?? previous.version,
                ontologyVersionId: pinnedVersion?.id,
                provenance: {
                  ...(cmd.provenance ?? {}),
                  ...(c.provenance ?? {}),
                  sourceEventId: cmd.sourceEventId,
                  observedAt: cmd.observedAt ?? clock(),
                },
              }));
              historyOp = 'update';
            }
                const result: ProjectionResult = {
              status: 'applied',
              operation: 'project_object',
              source: cmd.source,
              sourceEventId: cmd.sourceEventId,
              ontologyId: cmd.ontologyId,
              object,
            };
            await emit(stores, result, cmd.principal, historyOp === 'create' ? 'ObjectCreated' : 'ObjectModified');
            results.push(result);

          } else if (effect.kind === 'delete_object') {
            const c = effect.cmd;
            const deleted = await asValue(stores.objects.delete(cmd.ontologyId, c.objectTypeId, c.primaryKey, {
              expectedVersion: c.expectedVersion,
            }));
                const result: ProjectionResult = {
              status: 'applied',
              operation: 'delete_object',
              source: cmd.source,
              sourceEventId: cmd.sourceEventId,
              ontologyId: cmd.ontologyId,
              object: deleted,
              deleted: true,
            };
            if (deleted) await emit(stores, result, cmd.principal, 'ObjectDeleted');
            results.push(result);

          } else if (effect.kind === 'project_link') {
            const c = effect.cmd;
            const link = await asValue(stores.links.create({
              ontologyId: cmd.ontologyId,
              linkTypeId: c.linkTypeId,
              sourceObjectTypeId: c.sourceObjectTypeId,
              sourcePrimaryKey: c.sourcePrimaryKey,
              targetObjectTypeId: c.targetObjectTypeId,
              targetPrimaryKey: c.targetPrimaryKey,
              cardinality: c.cardinality,
              source: cmd.source,
              principal: cmd.principal,
              provenance: {
                ...(cmd.provenance ?? {}),
                ...(c.provenance ?? {}),
                sourceEventId: cmd.sourceEventId,
                observedAt: cmd.observedAt ?? clock(),
              },
            }));
            const result: ProjectionResult = {
              status: 'applied',
              operation: 'project_link',
              source: cmd.source,
              sourceEventId: cmd.sourceEventId,
              ontologyId: cmd.ontologyId,
              link,
            };
            await emit(stores, result, cmd.principal, 'LinkCreated');
            results.push(result);

          } else {
            // delete_link
            const c = (effect as { kind: 'delete_link'; cmd: typeof effect.cmd }).cmd as DeleteProjectedLinkCommand;
            const deleted = await asValue(
              stores.links.delete(
                cmd.ontologyId,
                c.linkTypeId,
                c.sourceObjectTypeId,
                c.sourcePrimaryKey,
                c.targetObjectTypeId,
                c.targetPrimaryKey,
              ),
            );
            const result: ProjectionResult = {
              status: 'applied',
              operation: 'delete_link',
              source: cmd.source,
              sourceEventId: cmd.sourceEventId,
              ontologyId: cmd.ontologyId,
              deleted: Boolean(deleted),
            };
            if (deleted) await emit(stores, result, cmd.principal, 'LinkDeleted');
            results.push(result);
          }
        }

        // Persist the batch result so replay can reconstruct per-effect outputs.
        const batchResultPayload: ProjectionResult = {
          status: 'applied',
          operation: batchOperation,
          source: cmd.source,
          sourceEventId: cmd.sourceEventId,
          ontologyId: cmd.ontologyId,
        };
        const resultWithEffects = { ...batchResultPayload, results };
        await stores.ledger.complete({ ...record, payloadHash: batchHash, result: resultWithEffects as unknown as ProjectionResult });

        return { status: 'applied', results };
      });
    },
  };
}
