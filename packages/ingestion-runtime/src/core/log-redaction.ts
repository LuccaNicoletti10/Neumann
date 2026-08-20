/**
 * ingestion-runtime — structural redaction for logs and connector config.
 * Values of secret-bearing keys are never copied into log events.
 */

export const SENSITIVE_CONFIG_KEYS =
  /^(secret|password|token|webhooksecret|apikey|authorization|clientsecret|client_secret)$/i;

const SENSITIVE_HEADER_KEYS =
  /^(authorization|x-neumann-signature|x-neumann-nonce|cookie|set-cookie)$/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_CONFIG_KEYS.test(key) || SENSITIVE_HEADER_KEYS.test(key);
}

export type IngestionLogEvent = {
  code: string;
  runId?: string;
  connectorId?: string;
  sourceEventId?: string;
  mappingVersionId?: string;
  hash?: string;
  count?: number;
  errorName?: string;
  errorCode?: string;
};

export type IngestionLogger = (event: IngestionLogEvent) => void;

const ALLOWED_LOG_KEYS = new Set([
  'code',
  'runId',
  'connectorId',
  'sourceEventId',
  'mappingVersionId',
  'hash',
  'count',
  'errorName',
  'errorCode',
]);

/** Drop any field that is not an id/hash/code/counter. */
export function sanitizeIngestionLog(event: IngestionLogEvent): IngestionLogEvent {
  const out: IngestionLogEvent = { code: event.code };
  for (const [key, value] of Object.entries(event)) {
    if (!ALLOWED_LOG_KEYS.has(key) || isSensitiveKey(key)) continue;
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function redactLogValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactLogValue(v, k);
    }
    return out;
  }
  return value;
}

export const noopIngestionLogger: IngestionLogger = () => undefined;
