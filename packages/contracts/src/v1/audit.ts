/**
 * contracts — src/v1/audit.ts
 * Audit log verificável e redigível com hash chain (Passo 16 / US20150188715).
 */

/** Identificador de entrada de audit. */
export type AuditEntryId = string;

export type AuditMessageType = 'GENESIS' | 'EVENT' | 'COMMIT' | 'REDACTED';

/** Entrada de audit (hash-chained). */
export interface AuditEntry {
  id: AuditEntryId;
  messageType: AuditMessageType;
  /** Payload do evento (null se redigido). */
  eventData: string | null;
  /** Metadados não sensíveis. */
  metadata: Record<string, string>;
  /** Salt (null se redigido — logHash preservado). */
  salt: string | null;
  /** Hash(eventData + salt). */
  logHash: string;
  /** Hash(logHash + metadata + previousSummaryHash). */
  summaryHash: string;
  /** Summary hash da entrada anterior (null na genesis). */
  previousSummaryHash: string | null;
  at: string;
  principal?: string;
}

/** Resultado de verificação da cadeia. */
export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  /** Índice da primeira falha, se houver. */
  brokenAt?: number;
  reason?: string;
}

/** Contrato do audit log. */
export interface AuditLog {
  begin(): AuditEntry;
  append(eventData: string, metadata?: Record<string, string>, principal?: string): AuditEntry;
  /** Sela o segmento atual (commit). */
  commit(note?: string): AuditEntry;
  /** Redige entrada: remove eventData/salt, preserva hashes da cadeia. */
  redact(entryId: AuditEntryId): AuditEntry;
  verify(): AuditVerifyResult;
  /** Detecta adulteração se alguém alterar summaryHash/logHash. */
  detectTamper(mutated: readonly AuditEntry[]): AuditVerifyResult;
  list(): readonly AuditEntry[];
  head(): AuditEntry | undefined;
}

export function buildGoldenAuditEntry(): AuditEntry {
  return {
    id: 'aud-1',
    messageType: 'EVENT',
    eventData: 'authorize deny read ds-secret',
    metadata: { op: 'authorize', decision: 'deny' },
    salt: 'salt-demo',
    logHash: 'b'.repeat(64),
    summaryHash: 'c'.repeat(64),
    previousSummaryHash: 'a'.repeat(64),
    at: '2024-06-01T12:00:00.000Z',
    principal: 'user-bob',
  };
}
