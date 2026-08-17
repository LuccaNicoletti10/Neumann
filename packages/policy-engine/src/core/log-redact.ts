/**
 * policy-engine — src/core/log-redact.ts
 * Logs observáveis não carregam payload classificado (canal logs).
 */

const SENSITIVE_KEY = /^(password|secret|token|ssn|note|body|email|hidden)$/i;

export function redactLogValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 120) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redactLogValue(v);
    }
    return out;
  }
  return value;
}

export function sanitizeLogLine(line: string, secrets: readonly string[] = []): string {
  let out = line;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join('[redacted]');
  }
  return out;
}

export function logFingerprint(lines: readonly string[], secrets: readonly string[] = []): string {
  const cleaned = lines.map((l) => sanitizeLogLine(l, secrets)).sort();
  return JSON.stringify(cleaned);
}
