/**
 * observability — src/harness.ts
 *
 * Captura de logs JSON, relatorio de cobertura TM0.5 e assert de 100% dos
 * campos obrigatorios por requisicao HTTP.
 */

import { Writable } from 'node:stream';
import type { DestinationStream } from 'pino';
import {
  REQUIRED_LOG_KEYS,
  type RequestLogFields,
} from './types.js';

const REQUEST_LOG_MARKER = 'request.completed';

/** Coleta linhas JSON emitidas por pino via destination stream. */
export class LogCapture {
  readonly lines: string[] = [];
  readonly destination: DestinationStream;

  constructor() {
    const lines = this.lines;
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          if (line.trim().length > 0) {
            lines.push(line);
          }
        }
        callback();
      },
    });
    this.destination = stream as unknown as DestinationStream;
  }

  clear(): void {
    this.lines.length = 0;
  }

  parseAll(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  requestLogs(): RequestLogFields[] {
    return this.parseAll()
      .filter((entry) => entry['msg'] === REQUEST_LOG_MARKER)
      .map((entry) => entry as unknown as RequestLogFields);
  }
}

export function isCompleteRequestLog(entry: Record<string, unknown>): boolean {
  for (const key of REQUIRED_LOG_KEYS) {
    const value = entry[key];
    if (value === undefined || value === null || value === '') {
      return false;
    }
  }
  if (typeof entry['duration_ms'] !== 'number' || Number.isNaN(entry['duration_ms'])) {
    return false;
  }
  return true;
}

export function coverageReport(logs: RequestLogFields[]): {
  total: number;
  complete: number;
  incomplete: number;
} {
  const total = logs.length;
  let complete = 0;
  for (const log of logs) {
    if (isCompleteRequestLog(log as unknown as Record<string, unknown>)) {
      complete += 1;
    }
  }
  return {
    total,
    complete,
    incomplete: total - complete,
  };
}

export function assertRequestCoverage(logs: RequestLogFields[]): void {
  const report = coverageReport(logs);
  if (report.incomplete > 0 || report.total === 0) {
    const missing: string[] = [];
    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i] as unknown as Record<string, unknown>;
      const absent = REQUIRED_LOG_KEYS.filter((key) => {
        const value = entry[key];
        return value === undefined || value === null || value === '';
      });
      if (absent.length > 0) {
        missing.push(`log[${i}] missing: ${absent.join(', ')}`);
      }
    }
    if (report.total === 0) {
      missing.push('no request.completed logs captured');
    }
    throw new Error(
      `TM0.5 coverage failed: ${report.complete}/${report.total} complete. ${missing.join('; ')}`,
    );
  }
}

export { REQUEST_LOG_MARKER };
export { REQUIRED_LOG_KEYS } from './types.js';
