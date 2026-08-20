/**
 * ingestion-runtime — IngestionRuntime.
 *
 * Connector → envelope → pinned MappingVersion → ProjectionBatch → ProjectionWriter.
 * Retry / quarantine / lease / checkpoint stay inside this module.
 */

import type { CheckpointStore } from 'connector-sdk';
import {
  allowsMutation,
  assertMappingDefinition,
  assertRawEnvelope,
  pinFromMappingVersion,
  type AuthorizeFn,
  type ConnectorRegistrationRepository,
  type IngestionQuarantineEntry,
  type IngestionRun,
  type IngestionRunId,
  type IngestionRuntime,
  type IngestionWebhookResult,
  type MappingVersion,
  type ProjectionWriter,
  type RawEnvelope,
} from 'contracts';
import {
  hashCanonical,
  OntologyValidationError,
  ProjectionConflictError,
  ProjectionDeniedError,
} from 'object-platform';

import {
  authenticateWebhook,
  webhookSecretKey,
  type SecretResolver,
} from './authenticate-push.js';
import type { ConnectorRegistry } from './envelope-source.js';
import {
  ConnectorUnavailableError,
  IngestionCrashFailpointError,
  IngestionDeniedError,
  IngestionEventConflictError,
  IngestionLeaseHeldError,
  MappingTransformError,
  PayloadTooLargeError,
  WebhookAuthenticationError,
  WebhookNonceReuseError,
} from './errors.js';
import type { IngestionStore } from './ingestion-store.js';
import {
  noopIngestionLogger,
  sanitizeIngestionLog,
  type IngestionLogger,
} from './log-redaction.js';
import type { MappingCatalog } from './mapping-catalog.js';
import { envelopeToEffects } from './mapping-transform.js';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateIngestionRuntimeOptions {
  projections: ProjectionWriter;
  catalog: MappingCatalog;
  connectors: ConnectorRegistry;
  store: IngestionStore;
  checkpoints: CheckpointStore;
  authorize: AuthorizeFn;
  resourceId: string;
  clock: Clock;
  nextId: IdGenerator;
  secrets?: SecretResolver;
  registrations?: ConnectorRegistrationRepository;
  leaseMs?: number;
  maxAttempts?: number;
  pageSize?: number;
  maxBodyBytes?: number;
  maxSkewMs?: number;
  /**
   * Test-only. Invoked after ProjectionWriter commit and before checkpoint.
   * Production must not set this.
   */
  afterProjectionBeforeCheckpoint?: () => Promise<void>;
  log?: IngestionLogger;
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isPermanent(err: unknown): boolean {
  return (
    err instanceof MappingTransformError ||
    err instanceof ProjectionConflictError ||
    err instanceof ProjectionDeniedError ||
    err instanceof OntologyValidationError ||
    err instanceof WebhookAuthenticationError ||
    err instanceof IngestionDeniedError
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseWebhookPayload(raw: string, connectorId: string, occurredAt: string): RawEnvelope {
  const parsed: unknown = JSON.parse(raw);
  const rec = (parsed ?? {}) as Record<string, unknown>;
  const nested =
    rec.payload !== undefined && typeof rec.payload === 'object' && !Array.isArray(rec.payload)
      ? (rec.payload as Record<string, unknown>)
      : rec;
  const sourceEventId = String(rec.id ?? rec.sourceEventId ?? nested.id ?? '');
  if (!sourceEventId) throw new MappingTransformError('webhook payload missing id');
  return {
    connectorId,
    source: String(rec.source ?? connectorId),
    sourceEventId,
    sourceSchemaVersion: rec.schema_version == null ? undefined : String(rec.schema_version),
    occurredAt: rec.occurredAt == null ? occurredAt : String(rec.occurredAt),
    payload: nested,
    metadata: { path: 'webhook' },
  };
}

export function createIngestionRuntime(opts: CreateIngestionRuntimeOptions): IngestionRuntime {
  if (!opts.authorize) throw new Error('IngestionRuntime requires authorize (fail-closed)');
  if (!opts.resourceId) throw new Error('IngestionRuntime requires resourceId');
  const leaseMs = opts.leaseMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const pageSize = opts.pageSize ?? 100;
  const maxBodyBytes = opts.maxBodyBytes ?? 1_048_576;
  const maxSkewMs = opts.maxSkewMs ?? 5 * 60 * 1000;
  function emit(event: Parameters<IngestionLogger>[0]): void {
    (opts.log ?? noopIngestionLogger)(sanitizeIngestionLog(event));
  }

  function authorize(principal: string): void {
    const decision = opts.authorize({
      principal,
      resource: opts.resourceId,
      operation: 'create',
    });
    if (!allowsMutation(decision)) throw new IngestionDeniedError();
  }

  async function pinMapping(
    mappingId: string,
    ontologyId: string,
    mappingVersionId: string | undefined,
  ) {
    const mv: MappingVersion | undefined = mappingVersionId
      ? await opts.catalog.getVersion(mappingVersionId)
      : await opts.catalog.getLatest(mappingId);
    if (!mv) {
      throw new MappingTransformError(
        mappingVersionId
          ? `mapping version "${mappingVersionId}" not found`
          : `mapping "${mappingId}" has no committed version`,
      );
    }
    if (mv.mappingId !== mappingId) {
      throw new MappingTransformError(
        `mapping version "${mv.id}" belongs to "${mv.mappingId}", not "${mappingId}"`,
      );
    }
    assertMappingDefinition({
      objectTypeId: mv.objectTypeId,
      primaryKeyFields: mv.primaryKeyFields,
      propertyMappings: mv.propertyMappings,
      linkMappings: mv.linkMappings,
    });
    return pinFromMappingVersion(mv, ontologyId);
  }

  async function createRun(input: {
    kind: IngestionRun['kind'];
    connectorId: string;
    mappingId: string;
    ontologyId: string;
    principal: string;
    mappingVersionId?: string;
    objectName: string;
    cursor?: string;
  }): Promise<IngestionRun> {
    authorize(input.principal);
    const now = opts.clock();
    const pin = await pinMapping(input.mappingId, input.ontologyId, input.mappingVersionId);
    const run: IngestionRun = {
      id: opts.nextId('ing'),
      kind: input.kind,
      status: 'pending',
      connectorId: input.connectorId,
      principal: input.principal,
      pin,
      cursor: input.cursor,
      objectName: input.objectName,
      processedCount: 0,
      quarantinedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await opts.store.insertRun(run);
    return run;
  }

  async function quarantine(
    run: IngestionRun,
    envelope: RawEnvelope,
    reason: string,
    attempts: number,
  ): Promise<void> {
    const entry: IngestionQuarantineEntry = {
      id: opts.nextId('qtn'),
      runId: run.id,
      envelope,
      reason,
      attempts,
      pin: run.pin,
      createdAt: opts.clock(),
    };
    await opts.store.insertQuarantine(entry);
    run.quarantinedCount += 1;
    run.status = 'quarantined';
    run.error = reason;
    run.updatedAt = opts.clock();
    await opts.store.saveRun(run);
    emit({
      code: 'INGESTION_QUARANTINED',
      runId: run.id,
      connectorId: run.connectorId,
      sourceEventId: envelope.sourceEventId,
    });
  }

  async function projectEnvelope(run: IngestionRun, envelope: RawEnvelope): Promise<void> {
    assertRawEnvelope(envelope);
    const effects = envelopeToEffects({
      envelope,
      definition: run.pin.definition,
      ontologyId: run.pin.ontologyId,
      principal: run.principal,
    });
    await opts.projections.projectBatch({
      source: envelope.source,
      ontologyId: run.pin.ontologyId,
      ontologyVersionId: run.pin.ontologyVersionId,
      sourceEventId: envelope.sourceEventId,
      principal: run.principal,
      observedAt: envelope.occurredAt,
      provenance: {
        mappingVersionId: run.pin.mappingVersionId,
        mappingHash: run.pin.hash,
        connectorId: envelope.connectorId,
      },
      effects,
    });
  }

  async function withRetry(run: IngestionRun, envelope: RawEnvelope): Promise<'ok' | 'quarantined'> {
    let last: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await projectEnvelope(run, envelope);
        return 'ok';
      } catch (err) {
        last = err;
        if (isPermanent(err) || attempt === maxAttempts) {
          await quarantine(run, envelope, messageOf(err), attempt);
          return 'quarantined';
        }
      }
    }
    await quarantine(run, envelope, messageOf(last), maxAttempts);
    return 'quarantined';
  }

  async function processEnvelopes(
    run: IngestionRun,
    envelopes: readonly RawEnvelope[],
    queuedIds?: readonly string[],
  ): Promise<IngestionRun> {
    for (let i = 0; i < envelopes.length; i += 1) {
      const envelope = envelopes[i]!;
      const outcome = await withRetry(run, envelope);
      if (outcome === 'ok') {
        const checkpoint = envelope.metadata.checkpoint;
        // WHY: delayed checkpoint is safe because ProjectionWriter already committed
        // and the ledger claimed sourceEventId; a replay cannot duplicate domain effects.
        if (opts.afterProjectionBeforeCheckpoint) {
          await opts.afterProjectionBeforeCheckpoint();
        }
        run.processedCount += 1;
        if (checkpoint) {
          run.cursor = checkpoint;
          await opts.checkpoints.set(run.connectorId, run.objectName, { token: checkpoint });
        }
      }
      if (queuedIds?.[i]) {
        await opts.store.markEnvelope(queuedIds[i]!, outcome === 'ok' ? 'processed' : 'quarantined');
      }
    }
    return run;
  }

  return {
    async enqueueWebhook(input) {
      const registration = opts.registrations
        ? await opts.registrations.get(input.connectorId)
        : undefined;
      if (opts.registrations && input.rawBody !== undefined) {
        if (!registration) {
          emit({
            code: 'CONNECTOR_UNAVAILABLE',
            connectorId: input.connectorId,
            errorCode: 'NOT_FOUND',
          });
          throw new ConnectorUnavailableError('missing');
        }
        if (!registration.enabled) {
          emit({
            code: 'CONNECTOR_UNAVAILABLE',
            connectorId: input.connectorId,
            errorCode: 'FORBIDDEN',
          });
          throw new ConnectorUnavailableError('disabled');
        }
      }

      let envelope = input.envelope;
      if (input.rawBody !== undefined) {
        if (input.rawBody.length > maxBodyBytes) throw new PayloadTooLargeError(maxBodyBytes);
        if (!opts.secrets) throw new WebhookAuthenticationError('webhook secrets not configured');
        const secretKey = registration?.secretRef ?? webhookSecretKey(input.connectorId);
        const secret = await opts.secrets.get(secretKey);
        if (!secret) throw new WebhookAuthenticationError('webhook secret missing');
        try {
          await authenticateWebhook({
            rawBody: input.rawBody,
            signature: input.signature ?? '',
            timestamp: input.timestamp ?? '',
            nonce: input.nonce ?? '',
            secret,
            nowMs: Date.parse(opts.clock()),
            maxSkewMs,
          });
        } catch (err) {
          emit({
            code: 'WEBHOOK_AUTH',
            connectorId: input.connectorId,
            errorName: err instanceof Error ? err.name : 'Error',
          });
          throw err;
        }
        await opts.store.purgeExpiredNonces(opts.clock());
        envelope = parseWebhookPayload(input.rawBody, input.connectorId, opts.clock());
      }
      if (!envelope) throw new MappingTransformError('enqueueWebhook requires envelope or rawBody');
      assertRawEnvelope(envelope);

      const mappingId = input.mappingId ?? registration?.mappingId;
      const ontologyId = input.ontologyId ?? registration?.ontologyId;
      const principal = registration?.servicePrincipal ?? input.principal;
      if (!mappingId || !ontologyId) {
        throw new MappingTransformError('enqueueWebhook requires mappingId and ontologyId');
      }
      if (!principal) throw new MappingTransformError('enqueueWebhook requires principal');
      authorize(principal);

      const now = opts.clock();
      const pin = await pinMapping(mappingId, ontologyId, input.mappingVersionId);
      const run: IngestionRun = {
        id: opts.nextId('ing'),
        kind: 'webhook',
        status: 'pending',
        connectorId: input.connectorId,
        principal,
        pin,
        objectName: 'events',
        processedCount: 0,
        quarantinedCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      let accepted;
      try {
        accepted = await opts.store.acceptWebhook({
          connectorId: input.connectorId,
          sourceEventId: envelope.sourceEventId,
          payloadHash: hashCanonical(envelope.payload),
          envelope,
          envelopeId: opts.nextId('env'),
          run,
          now,
          nonce: input.nonce,
          nonceExpiresAt: addMs(now, maxSkewMs * 2),
        });
      } catch (err) {
        if (err instanceof WebhookNonceReuseError || err instanceof IngestionEventConflictError) {
          emit({
            code: err instanceof WebhookNonceReuseError ? 'INGESTION_NONCE_REPLAY' : 'INGESTION_EVENT_CONFLICT',
            connectorId: input.connectorId,
            sourceEventId: envelope.sourceEventId,
            errorName: err.errorName,
          });
        }
        throw err;
      }
      emit({
        code: accepted.replayed ? 'INGESTION_REPLAYED' : 'INGESTION_ACCEPTED',
        runId: accepted.run.id,
        connectorId: input.connectorId,
        sourceEventId: envelope.sourceEventId,
        mappingVersionId: pin.mappingVersionId,
        hash: pin.hash,
      });
      const result: IngestionWebhookResult = {
        ...accepted.run,
        sourceEventId: envelope.sourceEventId,
        replayed: accepted.replayed,
      };
      return result;
    },

    async startPull(input) {
      authorize(input.principal);
      if (!(await opts.connectors.resolve(input.connectorId))) {
        throw new MappingTransformError(`unknown connector "${input.connectorId}"`);
      }
      const objectName = input.objectName ?? 'default';
      const cursor = (await opts.checkpoints.get(input.connectorId, objectName))?.token;
      return createRun({
        kind: 'pull',
        connectorId: input.connectorId,
        mappingId: input.mappingId,
        ontologyId: input.ontologyId,
        principal: input.principal,
        mappingVersionId: input.mappingVersionId,
        objectName,
        cursor,
      });
    },

    async runOnce(runId: IngestionRunId) {
      const existing = await opts.store.getRun(runId);
      if (!existing) throw new Error(`unknown ingestion run: ${runId}`);
      authorize(existing.principal);
      const now = opts.clock();
      const workerId = opts.nextId('worker');
      let run: IngestionRun;
      try {
        run = await opts.store.acquireLease({
          runId,
          workerId,
          leaseUntil: addMs(now, leaseMs),
          now,
        });
      } catch (err) {
        if (err instanceof IngestionLeaseHeldError) throw err;
        throw err;
      }

      try {
        if (run.kind === 'webhook' || run.kind === 'retry') {
          const queued = await opts.store.listQueued(run.id);
          const page = queued.slice(0, pageSize);
          run = await processEnvelopes(
            run,
            page.map((q) => q.envelope),
            page.map((q) => q.id),
          );
          const remaining = await opts.store.listQueued(run.id);
          if (remaining.length === 0 && run.quarantinedCount === 0) run.status = 'completed';
          else if (remaining.length > 0) run.status = 'pending';
        } else {
          const source = await opts.connectors.resolve(run.connectorId);
          if (!source) throw new MappingTransformError(`unknown connector "${run.connectorId}"`);
          const page = await source.pullPage(run.cursor);
          const batch = page.envelopes.slice(0, pageSize);
          const moreInPage = page.envelopes.length > pageSize;
          run = await processEnvelopes(run, batch);
          const lastCheckpoint = batch[batch.length - 1]?.metadata.checkpoint;
          if (lastCheckpoint) run.cursor = lastCheckpoint;
          else if (page.nextCursor) run.cursor = page.nextCursor;
          const exhausted = page.completed && !moreInPage;
          if (exhausted && run.quarantinedCount === 0) run.status = 'completed';
          else if (exhausted && run.quarantinedCount > 0) run.status = 'quarantined';
          else run.status = 'pending';
        }
        run.updatedAt = opts.clock();
        await opts.store.saveRun(run);
        return run;
      } catch (err) {
        if (err instanceof IngestionCrashFailpointError) throw err;
        if (err instanceof IngestionDeniedError || err instanceof IngestionLeaseHeldError) throw err;
        run.status = 'failed';
        run.error = messageOf(err);
        run.updatedAt = opts.clock();
        await opts.store.saveRun(run);
        emit({
          code: 'INGESTION_RUN_FAILED',
          runId,
          connectorId: run.connectorId,
          errorName: err instanceof Error ? err.name : 'Error',
        });
        return run;
      } finally {
        await opts.store.releaseLease(runId, workerId);
      }
    },

    async getRun(runId) {
      return opts.store.getRun(runId);
    },

    async retryQuarantined(input) {
      authorize(input.principal);
      const entry = await opts.store.getQuarantine(input.quarantineId);
      if (!entry) throw new Error(`unknown quarantine: ${input.quarantineId}`);
      const now = opts.clock();
      const run: IngestionRun = {
        id: opts.nextId('ing'),
        kind: 'retry',
        status: 'pending',
        connectorId: entry.envelope.connectorId,
        principal: input.principal,
        pin: entry.pin,
        objectName: 'retry',
        processedCount: 0,
        quarantinedCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await opts.store.insertRun(run);
      await opts.store.enqueue(run.id, entry.envelope, opts.nextId('env'));
      emit({
        code: 'INGESTION_RETRY',
        runId: run.id,
        connectorId: run.connectorId,
        sourceEventId: entry.envelope.sourceEventId,
        mappingVersionId: run.pin.mappingVersionId,
      });
      return run;
    },
  };
}
