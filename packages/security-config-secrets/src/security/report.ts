/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * SecurityReport — relatorio JSON e texto (tabela) dos findings, com
 * totais por severidade e resultado do gate, para consumo do CI e humanos.
 */
import { severityLevels, type Severity } from './advisory-db.js';
import type { GateResult } from './policy-gate.js';
import { PolicyGate } from './policy-gate.js';
import type { Finding } from './scanner.js';

export interface ReportJson {
  generatedAt: string;
  totals: Record<Severity, number> & { all: number };
  gate: { decision: 'pass' | 'fail'; reasons: string[]; suppressed: number } | null;
  findings: Array<{
    advisoryId: string;
    package: string;
    version: string;
    kind: string;
    severity: Severity;
    title: string;
    fixedIn?: string;
  }>;
}

export class SecurityReport {
  constructor(
    private readonly findings: Finding[],
    private readonly gate: GateResult | null = null,
    private readonly generatedAt: Date = new Date(),
  ) {}

  toJson(): ReportJson {
    const totals = PolicyGate.totalsBySeverity(this.findings);
    return {
      generatedAt: this.generatedAt.toISOString(),
      totals: { ...totals, all: this.findings.length },
      gate: this.gate
        ? {
            decision: this.gate.decision,
            reasons: this.gate.reasons,
            suppressed: this.gate.suppressed,
          }
        : null,
      findings: this.findings.map((f) => ({
        advisoryId: f.advisory.id,
        package: f.dependency.name,
        version: f.dependency.version,
        kind: f.dependency.kind,
        severity: f.severity,
        title: f.advisory.title,
        ...(f.advisory.fixedIn !== undefined ? { fixedIn: f.advisory.fixedIn } : {}),
      })),
    };
  }

  toJsonString(): string {
    return JSON.stringify(this.toJson(), null, 2);
  }

  /** Tabela ASCII simples, sem dependencia externa. */
  toText(): string {
    const lines: string[] = [];
    lines.push(`Relatorio de seguranca — ${this.generatedAt.toISOString()}`);
    lines.push('');
    const totals = PolicyGate.totalsBySeverity(this.findings);
    lines.push(
      'Totais: ' +
        severityLevels.map((s) => `${s}=${totals[s]}`).join('  ') +
        `  (total=${this.findings.length})`,
    );
    if (this.gate) {
      lines.push(
        `Gate: ${this.gate.decision.toUpperCase()} (suprimidos=${this.gate.suppressed})`,
      );
    }
    lines.push('');
    const header = ['SEVERIDADE', 'ADVISORY', 'PACOTE', 'VERSAO', 'TIPO', 'TITULO'];
    const rows = this.findings.map((f) => [
      f.severity.toUpperCase(),
      f.advisory.id,
      f.dependency.name,
      f.dependency.version,
      f.dependency.kind,
      f.advisory.title,
    ]);
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
    );
    const fmt = (cols: string[]) =>
      cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
    lines.push(fmt(header));
    lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const row of rows) lines.push(fmt(row));
    if (rows.length === 0) lines.push('(nenhum finding)');
    if (this.gate && this.gate.reasons.length > 0) {
      lines.push('');
      lines.push('Motivos do gate:');
      for (const r of this.gate.reasons) lines.push(`  - ${r}`);
    }
    return lines.join('\n');
  }
}