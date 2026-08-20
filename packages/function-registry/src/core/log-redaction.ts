const SENSITIVE =
  /^(secret|password|token|authorization|apikey|clientsecret|signature)$/i;

export interface FunctionLogEvent {
  code: string;
  executionId?: string;
  functionId?: string;
  artifactHash?: string;
  errorCode?: string;
  count?: number;
}

export function redactFunctionLog(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactFunctionLog);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE.test(key) ? '[redacted]' : redactFunctionLog(nested);
  }
  return out;
}

export function functionLogAllowed(event: FunctionLogEvent): FunctionLogEvent {
  return {
    code: event.code,
    executionId: event.executionId,
    functionId: event.functionId,
    artifactHash: event.artifactHash,
    errorCode: event.errorCode,
    count: event.count,
  };
}
