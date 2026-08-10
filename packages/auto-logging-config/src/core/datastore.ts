/**
 * Datastore — persistencia em JSON do caminho do source repo,
 * da ordered list de padroes, threshold e similarity criterion.
 */

import * as fs from "fs";
import * as path from "path";
import { SearchPattern } from "./types";

export interface DatastoreState {
  repoPath: string | null;
  patterns: SearchPattern[];
  threshold: number;
  similarityCriterion: number;
}

export class Datastore {
  private state: DatastoreState = {
    repoPath: null,
    patterns: [],
    threshold: 100,
    similarityCriterion: 0.8,
  };

  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  load(): DatastoreState {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DatastoreState>;
      this.state = {
        repoPath: parsed.repoPath ?? null,
        patterns: parsed.patterns ?? [],
        threshold: parsed.threshold ?? 100,
        similarityCriterion: parsed.similarityCriterion ?? 0.8,
      };
    }
    return this.getState();
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getState(): DatastoreState {
    return {
      repoPath: this.state.repoPath,
      patterns: this.state.patterns.map((p) => ({
        ...p,
        source: { ...p.source },
        staticParts: [...p.staticParts],
        params: [...p.params],
      })),
      threshold: this.state.threshold,
      similarityCriterion: this.state.similarityCriterion,
    };
  }

  setState(state: Partial<DatastoreState>): void {
    this.state = { ...this.state, ...state };
  }
}

export function defaultDatastorePath(): string {
  return path.join(process.cwd(), "datastore.json");
}
