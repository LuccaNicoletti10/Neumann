/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * Suppressions com auditoria — permite suprimir um finding especifico
 * (advisoryId + packageName) com motivo, aprovador e expiracao. Supressao
 * expirada volta a falhar o gate. Toda gravacao/consulta e registrada em
 * trilha de auditoria append-only (audit.jsonl).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Finding } from './scanner.js';

export interface Suppression {
  advisoryId: string;
  packageName: string;
  reason: string;
  expiresAt: string; // ISO 8601
  approvedBy: string;
  createdAt: string; // ISO 8601
}

export type AuditAction = 'suppress' | 'lookup';

export interface AuditRecord {
  at: string; // ISO 8601
  action: AuditAction;
  actor: string;
  detail: Record<string, unknown>;
}

export class SuppressionStore {
  private suppressions: Suppression[] = [];

  constructor(
    private readonly filePath: string,
    private readonly auditPath: string,
  ) {
    if (existsSync(filePath)) {
      this.suppressions = JSON.parse(readFileSync(filePath, 'utf8')) as Suppression[];
    }
  }

  /** Registra uma supressao (persistida em JSON) e audita. */
  add(
    input: Omit<Suppression, 'createdAt'>,
    actor: string,
    now: Date = new Date(),
  ): Suppression {
    const sup: Suppression = { ...input, createdAt: now.toISOString() };
    // Substitui supressao existente para o mesmo advisory+pacote.
    this.suppressions = this.suppressions.filter(
      (s) => !(s.advisoryId === sup.advisoryId && s.packageName === sup.packageName),
    );
    this.suppressions.push(sup);
    this.persist();
    this.audit({
      at: now.toISOString(),
      action: 'suppress',
      actor,
      detail: {
        advisoryId: sup.advisoryId,
        packageName: sup.packageName,
        reason: sup.reason,
        expiresAt: sup.expiresAt,
        approvedBy: sup.approvedBy,
      },
    });
    return sup;
  }

  /**
   * Consulta (auditada) se um finding esta suprimido. Supressao expirada
   * NAO suprime — o finding volta a falhar o gate.
   */
  lookup(finding: Finding, actor: string, now: Date = new Date()): Suppression | null {
    const found =
      this.suppressions.find(
        (s) =>
          s.advisoryId === finding.advisory.id &&
          s.packageName === finding.dependency.name &&
          new Date(s.expiresAt).getTime() > now.getTime(),
      ) ?? null;
    this.audit({
      at: now.toISOString(),
      action: 'lookup',
      actor,
      detail: {
        advisoryId: finding.advisory.id,
        packageName: finding.dependency.name,
        suppressed: found !== null,
      },
    });
    return found;
  }

  list(): readonly Suppression[] {
    return this.suppressions;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.suppressions, null, 2), 'utf8');
  }

  private audit(record: AuditRecord): void {
    mkdirSync(dirname(this.auditPath), { recursive: true });
    appendFileSync(this.auditPath, JSON.stringify(record) + '\n', 'utf8');
  }
}