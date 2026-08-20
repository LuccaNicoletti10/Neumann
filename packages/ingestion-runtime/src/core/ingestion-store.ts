/**
 * ingestion-runtime — durable run / queue / quarantine / lease / webhook inbox.
 * Not an outbox. Checkpoint is the existing CheckpointStore port.
 */

import { IngestionLeaseHeldError, IngestionEventConflictError, WebhookNonceReuseError } from './errors.js';
import type {
  IngestionQuarantineEntry,
  IngestionQuarantineId,
  IngestionRun,
  IngestionRunId,
  RawEnvelope,
} from 'contracts';

export type QueuedEnvelopeStatus = 'queued' | 'processed' | 'quarantined';

export interface QueuedEnvelope {
  id: string;
  runId: IngestionRunId;
  envelope: RawEnvelope;
  status: QueuedEnvelopeStatus;
}

export interface AcceptWebhookInput {
  connectorId: string;
  sourceEventId: string;
  payloadHash: string;
  envelope: RawEnvelope;
  envelopeId: string;
  run: IngestionRun;
  now: string;
  nonce?: string;
  nonceExpiresAt?: string;
}

export interface AcceptWebhookResult {
  run: IngestionRun;
  replayed: boolean;
}

export interface IngestionStore {
  insertRun(run: IngestionRun): Promise<void>;
  getRun(id: IngestionRunId): Promise<IngestionRun | undefined>;
  saveRun(run: IngestionRun): Promise<void>;
  /**
   * CAS lease. Returns the run if this worker holds it.
   * WHY compare-and-set: two runOnce calls must not process the same page.
   */
  acquireLease(input: {
    runId: IngestionRunId;
    workerId: string;
    leaseUntil: string;
    now: string;
  }): Promise<IngestionRun>;
  releaseLease(runId: IngestionRunId, workerId: string): Promise<void>;
  enqueue(runId: IngestionRunId, envelope: RawEnvelope, id: string): Promise<void>;
  listQueued(runId: IngestionRunId): Promise<QueuedEnvelope[]>;
  markEnvelope(id: string, status: QueuedEnvelopeStatus): Promise<void>;
  insertQuarantine(entry: IngestionQuarantineEntry): Promise<void>;
  getQuarantine(id: IngestionQuarantineId): Promise<IngestionQuarantineEntry | undefined>;
  listQuarantine(runId: IngestionRunId): Promise<IngestionQuarantineEntry[]>;
  acceptWebhook(input: AcceptWebhookInput): Promise<AcceptWebhookResult>;
  listRunnable(limit: number, now: string): Promise<IngestionRunId[]>;
  /** Removes nonces whose expires_at is at or before `now`. Valid nonces stay. */
  purgeExpiredNonces(now: string): Promise<number>;
}

function cloneRun(run: IngestionRun): IngestionRun {
  return {
    ...run,
    pin: {
      ...run.pin,
      definition: {
        ...run.pin.definition,
        primaryKeyFields: [...run.pin.definition.primaryKeyFields],
        propertyMappings: run.pin.definition.propertyMappings.map((p) => ({ ...p })),
        linkMappings: run.pin.definition.linkMappings.map((l) => ({ ...l })),
      },
    },
  };
}

export function createMemoryIngestionStore(): IngestionStore {
  const runs = new Map<string, IngestionRun>();
  const envelopes = new Map<string, QueuedEnvelope>();
  const quarantine = new Map<string, IngestionQuarantineEntry>();
  const quarantineByEvent = new Set<string>();
  const inbox = new Map<string, { payloadHash: string; runId: string }>();
  const nonces = new Map<
    string,
    { sourceEventId: string; payloadHash: string; runId: string; expiresAt: string }
  >();

  return {
    async insertRun(run) {
      if (runs.has(run.id)) throw new Error(`ingestion run exists: ${run.id}`);
      runs.set(run.id, cloneRun(run));
    },
    async getRun(id) {
      const run = runs.get(id);
      return run ? cloneRun(run) : undefined;
    },
    async saveRun(run) {
      if (!runs.has(run.id)) throw new Error(`unknown ingestion run: ${run.id}`);
      runs.set(run.id, cloneRun(run));
    },
    async acquireLease(input) {
      const run = runs.get(input.runId);
      if (!run) throw new Error(`unknown ingestion run: ${input.runId}`);
      const held =
        run.workerId &&
        run.leaseUntil &&
        Date.parse(run.leaseUntil) > Date.parse(input.now) &&
        run.workerId !== input.workerId;
      if (held) throw new IngestionLeaseHeldError(input.runId);
      run.workerId = input.workerId;
      run.leaseUntil = input.leaseUntil;
      run.status = run.status === 'pending' ? 'running' : run.status;
      run.updatedAt = input.now;
      return cloneRun(run);
    },
    async releaseLease(runId, workerId) {
      const run = runs.get(runId);
      if (!run) return;
      if (run.workerId !== workerId) return;
      run.workerId = undefined;
      run.leaseUntil = undefined;
    },
    async enqueue(runId, envelope, id) {
      envelopes.set(id, { id, runId, envelope, status: 'queued' });
    },
    async listQueued(runId) {
      return [...envelopes.values()].filter((e) => e.runId === runId && e.status === 'queued');
    },
    async markEnvelope(id, status) {
      const row = envelopes.get(id);
      if (row) row.status = status;
    },
    async insertQuarantine(entry) {
      const key = `${entry.runId}:${entry.envelope.sourceEventId}`;
      if (quarantineByEvent.has(key)) return;
      quarantineByEvent.add(key);
      quarantine.set(entry.id, { ...entry, envelope: { ...entry.envelope } });
    },
    async getQuarantine(id) {
      const row = quarantine.get(id);
      return row ? { ...row, envelope: { ...row.envelope } } : undefined;
    },
    async listQuarantine(runId) {
      return [...quarantine.values()]
        .filter((row) => row.runId === runId)
        .map((row) => ({ ...row, envelope: { ...row.envelope } }));
    },
    async acceptWebhook(input) {
      if (input.nonce) {
        const nonceKey = `${input.connectorId}:${input.nonce}`;
        const existingNonce = nonces.get(nonceKey);
        if (existingNonce) {
          throw new WebhookNonceReuseError();
        }
      }
      const inboxKey = `${input.connectorId}:${input.sourceEventId}`;
      const existing = inbox.get(inboxKey);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash) {
          throw new IngestionEventConflictError();
        }
        if (input.nonce) {
          nonces.set(`${input.connectorId}:${input.nonce}`, {
            sourceEventId: input.sourceEventId,
            payloadHash: input.payloadHash,
            runId: existing.runId,
            expiresAt: input.nonceExpiresAt ?? input.now,
          });
        }
        const run = runs.get(existing.runId);
        if (!run) throw new Error(`unknown ingestion run: ${existing.runId}`);
        return { run: cloneRun(run), replayed: true };
      }
      runs.set(input.run.id, cloneRun(input.run));
      envelopes.set(input.envelopeId, {
        id: input.envelopeId,
        runId: input.run.id,
        envelope: input.envelope,
        status: 'queued',
      });
      inbox.set(inboxKey, { payloadHash: input.payloadHash, runId: input.run.id });
      if (input.nonce) {
        nonces.set(`${input.connectorId}:${input.nonce}`, {
          sourceEventId: input.sourceEventId,
          payloadHash: input.payloadHash,
          runId: input.run.id,
          expiresAt: input.nonceExpiresAt ?? input.now,
        });
      }
      return { run: cloneRun(input.run), replayed: false };
    },
    async listRunnable(limit, now) {
      const nowMs = Date.parse(now);
      const ids: string[] = [];
      const sorted = [...runs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const run of sorted) {
        if (ids.length >= limit) break;
        if (run.status === 'pending') {
          ids.push(run.id);
          continue;
        }
        if (run.status !== 'running') continue;
        const leaseMs = run.leaseUntil ? Date.parse(run.leaseUntil) : 0;
        if (!run.workerId || !run.leaseUntil || leaseMs <= nowMs) ids.push(run.id);
      }
      return ids;
    },
    async purgeExpiredNonces(now) {
      const nowMs = Date.parse(now);
      let removed = 0;
      for (const [key, row] of [...nonces.entries()]) {
        if (Date.parse(row.expiresAt) <= nowMs) {
          nonces.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
