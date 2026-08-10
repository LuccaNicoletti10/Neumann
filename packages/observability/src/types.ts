/**
 * observability — src/types.ts
 *
 * Tipos compartilhados para identidade de serviço, contexto de principal e
 * campos obrigatórios de log por requisição (gate TM0.5).
 */

export interface ServiceIdentity {
  service: string;
  version: string;
  deploymentId: string;
}

export interface PrincipalContext {
  id: string;
  kind: 'user' | 'service' | 'anonymous';
  tenantId: string;
}

export interface RequestLogFields {
  trace_id: string;
  principal: string;
  tenant_id: string;
  service: string;
  version: string;
  deployment_id: string;
  operation: string;
  duration_ms: number;
  result: 'ok' | 'error' | 'denied';
  correlation_id?: string;
}

export const REQUIRED_LOG_KEYS = [
  'trace_id',
  'principal',
  'tenant_id',
  'service',
  'version',
  'deployment_id',
  'operation',
  'duration_ms',
  'result',
] as const;
