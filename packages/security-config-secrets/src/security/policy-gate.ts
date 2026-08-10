/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * SecurityPolicy + CI gate — avalia os findings do scanner contra uma
 * politica configuravel e decide pass/fail (o CLI sai com exit code 1 em
 * fail, bloqueando o pipeline). Respeita supressoes ativas via
 * SuppressionStore; supressao expirada volta a falhar.
 */
import { z } from 'zod';
import { atLeastSeverity, severityLevels, severityRank, type Severity } from './advisory-db.js';
import type { Finding } from './scanner.js';
import type { SuppressionStore } from './suppressions.js';

export const securityPolicySchema = z.object({
  failOnSeverity: z.enum(severityLevels).default('high'),
  maxFindings: z.number().int().nonnegative().optional(),
  allowedLicenses: z.array(z.string()).optional(),
});

export type SecurityPolicy = z.infer<typeof securityPolicySchema>;

export interface GateResult {
  decision: 'pass' | 'fail';
  reasons: string[];
  evaluated: number;
  suppressed: number;
}

export class PolicyGate {
  constructor(
    private readonly policy: SecurityPolicy,
    private readonly suppressions?: SuppressionStore,
    private readonly auditActor: string = 'ci',
  ) {}

  evaluate(findings: Finding[], now: Date = new Date()): GateResult {
    const reasons: string[] = [];
    const active: Finding[] = [];
    let suppressedCount = 0;

    for (const finding of findings) {
      const sup = this.suppressions?.lookup(finding, this.auditActor, now);
      if (sup) {
        suppressedCount++;
        continue;
      }
      active.push(finding);
    }

    const blocking = active.filter((f) =>
      atLeastSeverity(f.severity, this.policy.failOnSeverity),
    );
    for (const f of blocking) {
      reasons.push(
        `${f.severity.toUpperCase()} ${f.advisory.id}: ${f.dependency.name}@${f.dependency.version} — ${f.advisory.title}` +
          (f.advisory.fixedIn ? ` (corrigido em ${f.advisory.fixedIn})` : ''),
      );
    }

    if (
      this.policy.maxFindings !== undefined &&
      active.length > this.policy.maxFindings
    ) {
      reasons.push(
        `Total de findings ativos (${active.length}) excede maxFindings=${this.policy.maxFindings}.`,
      );
    }

    const decision = reasons.length === 0 ? 'pass' : 'fail';
    if (decision === 'pass' && active.length > 0) {
      reasons.push(
        `Findings abaixo do limiar (${this.policy.failOnSeverity}): ${active
          .map((f) => `${f.advisory.id}[${f.severity}]`)
          .join(', ')}.`,
      );
    }
    return { decision, reasons, evaluated: findings.length, suppressed: suppressedCount };
  }

  /** Totais por severidade (usado pelo relatorio e pelo gate). */
  static totalsBySeverity(findings: Finding[]): Record<Severity, number> {
    const totals: Record<Severity, number> = { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const f of findings) totals[f.severity]++;
    return totals;
  }

  static highestSeverity(findings: Finding[]): Severity | null {
    let best: Severity | null = null;
    for (const f of findings) {
      if (best === null || severityRank(f.severity) < severityRank(best)) best = f.severity;
    }
    return best;
  }
}