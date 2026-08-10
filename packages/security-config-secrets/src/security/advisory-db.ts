/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * AdvisoryDatabase — base local de advisories de vulnerabilidade em JSON,
 * com matching pacote + range semver (motor proprio em semver.ts).
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { satisfiesRange } from './semver.js';
import type { Dependency } from './dependency-inventory.js';

export const severityLevels = ['critical', 'high', 'moderate', 'low'] as const;
export type Severity = (typeof severityLevels)[number];

/** critical(0) .. low(3): menor numero = mais severo. */
export function severityRank(s: Severity): number {
  return severityLevels.indexOf(s);
}

/** true se `a` e pelo menos tao severo quanto `threshold`. */
export function atLeastSeverity(a: Severity, threshold: Severity): boolean {
  return severityRank(a) <= severityRank(threshold);
}

export const advisorySchema = z.object({
  id: z.string().min(1),
  packageName: z.string().min(1),
  affectedRanges: z.array(z.string().min(1)).min(1),
  severity: z.enum(severityLevels),
  title: z.string().min(1),
  fixedIn: z.string().optional(),
});

export type Advisory = z.infer<typeof advisorySchema>;

export class AdvisoryDatabase {
  private readonly advisories: Advisory[] = [];

  private constructor() {}

  static fromFile(path: string): AdvisoryDatabase {
    return AdvisoryDatabase.fromJson(readFileSync(path, 'utf8'));
  }

  static fromJson(text: string): AdvisoryDatabase {
    const parsed = z.array(advisorySchema).parse(JSON.parse(text));
    const db = new AdvisoryDatabase();
    db.advisories.push(...parsed);
    return db;
  }

  static fromAdvisories(list: Advisory[]): AdvisoryDatabase {
    const db = new AdvisoryDatabase();
    for (const a of list) db.advisories.push(advisorySchema.parse(a));
    return db;
  }

  get size(): number {
    return this.advisories.length;
  }

  /** Retorna advisories cujo pacote casa o nome e cujo range casa a versao. */
  match(dep: Dependency): Advisory[] {
    return this.advisories.filter(
      (a) =>
        a.packageName === dep.name &&
        a.affectedRanges.some((range) => satisfiesRange(dep.version, range)),
    );
  }

  all(): readonly Advisory[] {
    return this.advisories;
  }
}