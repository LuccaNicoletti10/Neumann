/**
 * action-engine — src/core/writeback-cycle.ts
 * Passo 25: Action outbox → Connector.writeBack → fonte muda → object converge → audit.
 */

import type {
  AuditLog,
  ObjectRepository,
  OperationalEventStore,
  OutboxInsertInput,
  PropertyMapping,
} from 'contracts';
import {
  createMemoryWriteBackConnector,
  propertiesToSourceFields,
  sourceFieldsToProperties,
  type MemoryWriteBackConnector,
} from 'connector-sdk';

export interface DrainWriteBackOptions {
  outboxRecords: OutboxInsertInput[];
  connector: MemoryWriteBackConnector;
  objects: ObjectRepository;
  ontologyId: string;
  objectTypeId: string;
  mappings: readonly PropertyMapping[];
  events: OperationalEventStore;
  audit: AuditLog;
  principal: string;
}

export async function drainWriteBackToConnector(
  opts: DrainWriteBackOptions,
): Promise<{ drained: number }> {
  let drained = 0;
  for (const rec of opts.outboxRecords) {
    if (rec.topic !== 'action.side_effect.writeback') continue;
    const payload = rec.payload;
    const params =
      payload.params && typeof payload.params === 'object'
        ? (payload.params as Record<string, unknown>)
        : payload;
    const pk = String(params.orderId ?? params.id ?? '');
    if (!pk) continue;
    const obj = await opts.objects.get(opts.ontologyId, opts.objectTypeId, pk);
    if (!obj) continue;
    const fields = propertiesToSourceFields(obj.properties, opts.mappings);
    const operation = typeof payload.operation === 'string' ? payload.operation : 'writeback';
    const result = await opts.connector.writeBack!({
      object: { sourceSystem: 'ext', objectName: 'orders' },
      primaryKey: pk,
      operation,
      fields,
      idempotencyKey: `neumann:${rec.traceId ?? rec.key}`,
    });
    if (!result.ok) {
      await opts.events.append({
        kind: 'ExternalWritebackFailed',
        ontologyId: opts.ontologyId,
        principal: rec.principal,
        actionExecutionId: rec.traceId,
        payload: { error: result.error, pk },
      });
      continue;
    }
    drained += 1;
    await opts.events.append({
      kind: 'ExternalWritebackSucceeded',
      ontologyId: opts.ontologyId,
      principal: rec.principal,
      actionExecutionId: rec.traceId,
      payload: { pk, record: result.record },
    });
    const patch = sourceFieldsToProperties(result.record ?? {}, opts.mappings);
    const updated = await opts.objects.update(opts.ontologyId, opts.objectTypeId, pk, {
      properties: patch,
    });
    await opts.events.append({
      kind: 'ObjectModified',
      ontologyId: opts.ontologyId,
      principal: rec.principal,
      objectId: updated.id,
      objectTypeId: updated.objectTypeId,
      primaryKey: updated.primaryKey,
      payload: { source: 'writeback-converge', properties: patch },
    });
    await opts.audit.append(
      JSON.stringify({
        kind: 'WriteBackConverged',
        primaryKey: pk,
        source: result.record,
        objectVersion: updated.version,
      }),
      { ontologyId: opts.ontologyId, kind: 'WriteBackConverged' },
      opts.principal,
    );
  }
  return { drained };
}

export function demoMappings(): PropertyMapping[] {
  return [
    { sourceField: 'order_status', propertyTypeId: 'status' },
    { sourceField: 'amt', propertyTypeId: 'amount' },
  ];
}

export function demoSourceConnector(): MemoryWriteBackConnector {
  return createMemoryWriteBackConnector({
    records: { 'SO-1': { order_status: 'pending', amt: 150 } },
  });
}
