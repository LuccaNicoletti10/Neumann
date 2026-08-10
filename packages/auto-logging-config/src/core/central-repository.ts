/**
 * CentralLogRepository — repositorio central de structured log entries.
 */

import { StructuredLogEntry } from "./types";

export interface LogQuery {
  patternId?: string;
  function?: string;
  params?: Record<string, string>;
}

export class CentralLogRepository {
  private entries: StructuredLogEntry[] = [];

  add(entry: StructuredLogEntry): void {
    this.entries.push(entry);
  }

  get size(): number {
    return this.entries.length;
  }

  all(): StructuredLogEntry[] {
    return [...this.entries];
  }

  query(q: LogQuery): StructuredLogEntry[] {
    return this.entries.filter((e) => {
      if (q.patternId !== undefined && e.patternId !== q.patternId) return false;
      if (q.function !== undefined && e.sourceFunction !== q.function) return false;
      if (q.params) {
        for (const [k, v] of Object.entries(q.params)) {
          if (e.params[k] !== v) return false;
        }
      }
      return true;
    });
  }

  countByPattern(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.entries) counts[e.patternId] = (counts[e.patternId] ?? 0) + 1;
    return counts;
  }

  countByFunction(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.entries) {
      const fn = e.sourceFunction ?? "<unknown>";
      counts[fn] = (counts[fn] ?? 0) + 1;
    }
    return counts;
  }

  clear(): void {
    this.entries = [];
  }
}
