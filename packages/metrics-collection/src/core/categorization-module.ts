/**
 * CategorizationModule — metrics type + categorias por padrão glob sobre UMI.
 */
import { parseUmi, umiFeatureKey, type ParsedUmi } from "./umi.js";

export interface CategoryDefinition {
  categoryId: string;
  featurePatterns: string[];
}

export type MetricsType = "point" | "duration";

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  { categoryId: "issues", featurePatterns: ["*:errors*", "*:crashes*", "*:issues*"] },
  { categoryId: "growth", featurePatterns: ["*:signups*", "*:activations*", "*:growth*"] },
  {
    categoryId: "engagement",
    featurePatterns: ["*:logins*", "*:views*", "*:sessions*", "*:engagement*"],
  },
  {
    categoryId: "performance",
    featurePatterns: ["*:latency*", "*:response.time*", "*:performance*"],
  },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function globToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^:]*";
      }
    } else {
      out += escapeRegex(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesPattern(pattern: string, umi: string | ParsedUmi): boolean {
  const parsed = typeof umi === "string" ? parseUmi(umi) : umi;
  return globToRegex(pattern).test(umiFeatureKey(parsed));
}

export class CategorizationModule {
  private categories = new Map<string, CategoryDefinition>();

  constructor(initial?: CategoryDefinition[]) {
    for (const def of initial ?? DEFAULT_CATEGORIES) {
      this.addCategory(def);
    }
  }

  metricsTypeOf(umi: string | ParsedUmi): MetricsType {
    const parsed = typeof umi === "string" ? parseUmi(umi) : umi;
    return parsed.isPoint ? "point" : "duration";
  }

  addCategory(def: CategoryDefinition): void {
    if (!def.categoryId || def.categoryId.trim().length === 0) {
      throw new Error("categoryId não pode ser vazio");
    }
    this.categories.set(def.categoryId, {
      categoryId: def.categoryId,
      featurePatterns: [...def.featurePatterns],
    });
  }

  addFeatureToCategory(categoryId: string, pattern: string): void {
    const def = this.categories.get(categoryId);
    if (!def) throw new Error(`Categoria "${categoryId}" não existe`);
    if (!def.featurePatterns.includes(pattern)) def.featurePatterns.push(pattern);
  }

  listCategories(): CategoryDefinition[] {
    return [...this.categories.values()].map((c) => ({
      categoryId: c.categoryId,
      featurePatterns: [...c.featurePatterns],
    }));
  }

  categorize(umi: string | ParsedUmi): string[] {
    const parsed = typeof umi === "string" ? parseUmi(umi) : umi;
    const key = umiFeatureKey(parsed);
    const result: string[] = [];
    for (const def of this.categories.values()) {
      if (def.featurePatterns.some((p) => globToRegex(p).test(key))) {
        result.push(def.categoryId);
      }
    }
    return result;
  }
}
