/**
 * entity-resolution — src/core/normalize.ts
 * Normalização determinística (Passo 20 / task 059).
 * lowercase, sem acentos/pontuação, CNPJ/CPF só dígitos, email/telefone canônicos.
 */

import type { EntityRecord, NormalizedFields, NormalizedRecord } from 'contracts';

const ACCENT_MAP: Record<string, string> = {
  á: 'a',
  à: 'a',
  ã: 'a',
  â: 'a',
  ä: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ó: 'o',
  ò: 'o',
  õ: 'o',
  ô: 'o',
  ö: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ç: 'c',
  ñ: 'n',
};

function stripAccents(s: string): string {
  return s.replace(/[áàãâäéèêëíìîïóòõôöúùûüçñ]/gi, (ch) => {
    const mapped = ACCENT_MAP[ch.toLowerCase()];
    return mapped ?? ch;
  });
}

/** Remove pontuação; mantém letras/dígitos/espaço. */
export function stripPunctuation(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeText(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return stripPunctuation(stripAccents(s.toLowerCase()));
}

/** CNPJ/CPF — só dígitos. */
export function normalizeDocument(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}

export function normalizeEmail(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (!s || !s.includes('@')) return undefined;
  return s;
}

/** Telefone E.164-ish: só dígitos (mantém país se presente). */
export function normalizePhone(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 8 ? digits : undefined;
}

function prop(rec: EntityRecord, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in rec.properties && rec.properties[k] != null && rec.properties[k] !== '') {
      return rec.properties[k];
    }
  }
  return undefined;
}

export function extractNormalizedFields(rec: EntityRecord): NormalizedFields {
  return {
    name: normalizeText(prop(rec, 'name', 'nome', 'razao_social', 'company_name')),
    document: normalizeDocument(prop(rec, 'document', 'cnpj', 'cpf', 'tax_id', 'documento')),
    email: normalizeEmail(prop(rec, 'email', 'e_mail', 'mail')),
    phone: normalizePhone(prop(rec, 'phone', 'telefone', 'tel', 'mobile')),
    city: normalizeText(prop(rec, 'city', 'cidade', 'municipio')),
  };
}

/**
 * Slug = concatenação de props identificadoras (US20140280252).
 * Ordem estável: document|email|phone|name|city
 */
export function buildSlug(fields: NormalizedFields): string {
  const parts = [
    fields.document ?? '',
    fields.email ?? '',
    fields.phone ?? '',
    fields.name ?? '',
    fields.city ?? '',
  ];
  return parts.join('|');
}

/**
 * Block keys: chave exata (documento/email/phone) + nome normalizado.
 * Nunca O(n²) — só compara quem compartilha pelo menos uma chave.
 */
export function buildBlockKeys(fields: NormalizedFields, objectTypeId: string): string[] {
  const keys = new Set<string>();
  const prefix = `ot:${objectTypeId}`;
  if (fields.document) keys.add(`${prefix}|doc:${fields.document}`);
  if (fields.email) keys.add(`${prefix}|email:${fields.email}`);
  if (fields.phone) keys.add(`${prefix}|phone:${fields.phone}`);
  if (fields.name) {
    keys.add(`${prefix}|name:${fields.name}`);
    // Prefixo do 1º token — blocking mais amplo para nomes parecidos
    const first = fields.name.split(/\s+/)[0];
    if (first && first.length >= 3) keys.add(`${prefix}|namepfx:${first}`);
  }
  return [...keys].sort();
}

export function normalizeRecord(rec: EntityRecord): NormalizedRecord {
  const fields = extractNormalizedFields(rec);
  return {
    recordId: rec.id,
    objectTypeId: rec.objectTypeId,
    sourceSystem: rec.sourceSystem,
    fields,
    slug: buildSlug(fields),
    blockKeys: buildBlockKeys(fields, rec.objectTypeId),
  };
}
