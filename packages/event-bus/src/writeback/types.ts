/**
 * event-bus — WritebackConnector
 * SQL mirror is an ERP *simulator sink*, not a real ERP integration.
 * HTTP connector sends Idempotency-Key: neumann:<outboxEventId>.
 */

export type WritebackConnectorKind = 'sql-mirror' | 'http' | 'mock';

export interface WritebackRequest {
  eventId: string;
  connectorId: string;
  operation: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  attempt: number;
  idempotencyKey: string;
}

export interface WritebackResult {
  ok: boolean;
  externalId?: string;
  externalOperationId?: string;
  statusCode?: number;
  responseHash?: string;
  responseMetadata?: Record<string, unknown>;
  error?: string;
  retryable?: boolean;
}

export interface WritebackConnector {
  readonly kind: WritebackConnectorKind;
  execute(request: WritebackRequest): Promise<WritebackResult>;
}

export interface WritebackExecutionRecord {
  id: string;
  outboxEventId: string;
  connectorId: string;
  operation: string;
  requestHash?: string;
  externalId?: string;
  externalOperationId?: string;
  status: 'STARTED' | 'SUCCEEDED' | 'FAILED';
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  responseHash?: string;
  responseMetadata?: Record<string, unknown>;
  idempotencyKey: string;
}
