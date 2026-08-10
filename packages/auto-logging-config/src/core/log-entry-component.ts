/**
 * LogEntryComponent — daemon que recebe output messages e estrutura ou dropa.
 */

import { CentralLogRepository } from "./central-repository";
import { OrderedPatternList } from "./search-pattern-module";
import { StructuredLogEntry } from "./types";

export interface IngestResult {
  status: "matched" | "dropped";
  entry?: StructuredLogEntry;
}

export interface DaemonStats {
  totalReceived: number;
  matched: number;
  dropped: number;
  perPatternMatchCounts: Record<string, number>;
}

export class LogEntryComponent {
  private readonly patternList = new OrderedPatternList();
  private totalReceived = 0;
  private matched = 0;
  private dropped = 0;

  constructor(private readonly repository: CentralLogRepository) {}

  setPatterns(list: OrderedPatternList): void {
    this.patternList.setAll(list.getAll());
  }

  get patterns(): OrderedPatternList {
    return this.patternList;
  }

  ingest(message: string, timestamp?: string): IngestResult {
    this.totalReceived++;
    const hit = this.patternList.match(message);
    if (!hit) {
      this.dropped++;
      return { status: "dropped" };
    }
    const entry: StructuredLogEntry = {
      patternId: hit.pattern.id,
      message,
      staticMatched: true,
      params: hit.params,
      timestamp: timestamp ?? new Date().toISOString(),
      sourceFunction: hit.pattern.source.function,
    };
    this.repository.add(entry);
    this.matched++;
    return { status: "matched", entry };
  }

  stats(): DaemonStats {
    const perPatternMatchCounts: Record<string, number> = {};
    for (const p of this.patternList.getAll()) {
      perPatternMatchCounts[p.id] = p.matchCount;
    }
    return {
      totalReceived: this.totalReceived,
      matched: this.matched,
      dropped: this.dropped,
      perPatternMatchCounts,
    };
  }
}
