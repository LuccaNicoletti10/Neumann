/**
 * HTTP log shaping. Values of secrets/headers never enter the stream.
 */
import { redactLogValue } from 'ingestion-runtime';

export function serializeHttpLogRequest(req: { method?: string; url?: string }): {
  method: string | undefined;
  url: string | undefined;
} {
  return { method: req.method, url: req.url };
}

export function serializeHttpLogError(err: {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
}): { type: string; message: string; stack: string; code: string | undefined } {
  return {
    type: err.name ?? 'Error',
    message: '[redacted]',
    stack: '',
    code: err.code,
  };
}

export function writeRedactedHttpLog(destination: { write(msg: string): void }, msg: string): void {
  try {
    const parsed: unknown = JSON.parse(msg);
    destination.write(`${JSON.stringify(redactLogValue(parsed))}\n`);
  } catch {
    destination.write(msg);
  }
}
