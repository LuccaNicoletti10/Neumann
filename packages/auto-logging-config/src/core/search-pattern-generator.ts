/**
 * SearchPatternGenerator — orquestra: examina repo -> gera patterns -> reduz -> persiste -> configura daemon.
 */

import { Datastore } from "./datastore";
import { LogEntryComponent } from "./log-entry-component";
import { ReducerModule, ReductionReport } from "./reducer-module";
import { OrderedPatternList, buildSearchPattern } from "./search-pattern-module";
import {
  SourceCodeRepository,
  DEFAULT_SIGNATURES,
  LoggingSignatureSet,
} from "./source-code-module";
import { LoggingCallExpression, SearchPattern } from "./types";

export interface GenerateOptions {
  threshold?: number;
  similarityThreshold?: number;
  signatures?: LoggingSignatureSet;
}

export interface GenerateResult {
  repoDir: string;
  loggingCalls: LoggingCallExpression[];
  patterns: SearchPattern[];
  report: ReductionReport;
}

export const DEFAULT_THRESHOLD = 100;
export const DEFAULT_SIMILARITY = 0.8;

export class SearchPatternGenerator {
  private readonly reducer = new ReducerModule();
  private lastResult: GenerateResult | null = null;

  constructor(private readonly datastore?: Datastore) {}

  generateConfig(repoDir: string, options: GenerateOptions = {}): GenerateResult {
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY;
    const repo = new SourceCodeRepository(repoDir, options.signatures ?? DEFAULT_SIGNATURES);
    const loggingCalls = repo.scan();

    const patterns: SearchPattern[] = [];
    let seq = 0;
    for (const call of loggingCalls) {
      if (call.formatString.length === 0) continue;
      patterns.push(buildSearchPattern(call, `pattern-${seq++}`));
    }

    const report = this.reducer.reduce(patterns, threshold, similarityThreshold);
    const list = new OrderedPatternList();
    list.setAll(patterns);

    const result: GenerateResult = { repoDir, loggingCalls, patterns: list.getAll(), report };
    this.lastResult = result;

    if (this.datastore) {
      this.datastore.setState({
        repoPath: repoDir,
        patterns: list.getAll(),
        threshold,
        similarityCriterion: similarityThreshold,
      });
      this.datastore.save();
    }
    return result;
  }

  configure(daemon: LogEntryComponent): void {
    const patterns = this.lastResult?.patterns ?? this.datastore?.load().patterns ?? [];
    const list = new OrderedPatternList();
    list.setAll(patterns.map((p) => ({ ...p, matchCount: 0 })));
    daemon.setPatterns(list);
  }
}
