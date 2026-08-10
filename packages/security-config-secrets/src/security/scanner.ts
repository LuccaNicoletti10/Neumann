/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * VulnerabilityScanner — cruza o DependencyInventory com a AdvisoryDatabase
 * e produz findings (advisory x dependencia x severidade).
 */
import type { Advisory, Severity } from './advisory-db.js';
import type { AdvisoryDatabase } from './advisory-db.js';
import type { Dependency, DependencyInventory } from './dependency-inventory.js';

export interface Finding {
  advisory: Advisory;
  dependency: Dependency;
  severity: Severity;
}

export class VulnerabilityScanner {
  constructor(private readonly db: AdvisoryDatabase) {}

  scan(inventory: DependencyInventory): Finding[] {
    const findings: Finding[] = [];
    for (const dep of inventory.dependencies) {
      for (const advisory of this.db.match(dep)) {
        findings.push({ advisory, dependency: dep, severity: advisory.severity });
      }
    }
    // Ordena do mais severo para o menos severo, depois por pacote/advisory.
    findings.sort(
      (a, b) =>
        sevOrder(a.severity) - sevOrder(b.severity) ||
        a.dependency.name.localeCompare(b.dependency.name) ||
        a.advisory.id.localeCompare(b.advisory.id),
    );
    return findings;
  }
}

function sevOrder(s: Severity): number {
  return ['critical', 'high', 'moderate', 'low'].indexOf(s);
}