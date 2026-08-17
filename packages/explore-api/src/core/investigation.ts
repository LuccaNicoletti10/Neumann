/**
 * explore-api — src/core/investigation.ts
 * Índice em blocos + busca 1/2 níveis (US 8,799,240). Sem uuid / Date.now.
 * Tokens por propriedade — hiddenProperties não entram no hit.
 */

import type {
  InvestigationIndexHit,
  InvestigationSearchResult,
  ObjectRecord,
  TokenTransform,
} from 'contracts';
import type { OntologyAuthorizer } from 'policy-engine';

import type { ExploreCatalog } from './catalog.js';
import type { IdGenerator } from './determinism.js';

export interface IndexValue {
  objectId: string;
  property: string;
  snippetOffset: number;
  snippetLength: number;
  text: string;
}

export interface InvestigationIndex {
  blocks: Map<string, string>;
  objectOfBlock: Map<string, string>;
  single: Map<string, IndexValue[]>;
  first: Map<string, string[]>;
  second: Map<string, IndexValue>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function transformTokens(tokens: string[], transforms: readonly TokenTransform[]): string[] {
  let out = [...tokens];
  for (const t of transforms) {
    if (t.type === 'canonicalize' && t.toLower !== false) {
      out = out.map((x) => x.toLowerCase());
    } else if (t.type === 'truncate') {
      out = out.map((x) => (x.length > t.maxLength ? x.slice(0, t.maxLength) : x));
    } else if (t.type === 'lookup') {
      out = out.map((x) => t.dictionary[x] ?? x);
    } else if (t.type === 'concatenate') {
      out = [out.join(t.delimiter ?? ' ')];
    }
  }
  return out;
}

function rangeKeyOf(obj: ObjectRecord): string {
  const amount = obj.properties.amount;
  if (typeof amount === 'number') return String(amount).padStart(12, '0');
  return obj.updatedAt || obj.createdAt;
}

export function buildInvestigationIndex(
  catalog: ExploreCatalog,
  opts: { nextId: IdGenerator; transforms?: readonly TokenTransform[] },
): InvestigationIndex {
  const transforms = opts.transforms ?? [{ type: 'canonicalize', toLower: true }];
  const blocks = new Map<string, string>();
  const objectOfBlock = new Map<string, string>();
  const single = new Map<string, IndexValue[]>();
  const first = new Map<string, string[]>();
  const second = new Map<string, IndexValue>();

  for (const obj of catalog.objects) {
    if (obj.deleted) continue;
    const blockId = opts.nextId('blk');
    const entries = [
      ['__type', obj.objectTypeId],
      ['__pk', obj.primaryKey],
      ...Object.entries(obj.properties).map(([k, v]) => [k, String(v ?? '')] as const),
    ] as Array<readonly [string, string]>;
    const data = entries.map(([k, v]) => `${k}:${v}`).join(' ');
    blocks.set(blockId, data);
    objectOfBlock.set(blockId, obj.id);

    for (const [property, text] of entries) {
      const tokens = transformTokens(tokenize(text), transforms);
      const unique = [...new Set(tokens)];
      const value: IndexValue = {
        objectId: obj.id,
        property,
        snippetOffset: 0,
        snippetLength: Math.min(80, text.length),
        text,
      };
      for (const tok of unique) {
        const list = single.get(tok) ?? [];
        list.push(value);
        single.set(tok, list);
        const secondKey = `${tok}|${rangeKeyOf(obj)}|${blockId}|${property}`;
        const firstList = first.get(tok) ?? [];
        firstList.push(secondKey);
        first.set(tok, firstList);
        second.set(secondKey, value);
      }
    }
  }

  return { blocks, objectOfBlock, single, first, second };
}

function propertyVisible(
  obj: ObjectRecord,
  property: string,
  principal: string,
  authorizer?: OntologyAuthorizer,
): boolean {
  if (property.startsWith('__')) return true;
  if (!authorizer) return true;
  const redacted = authorizer.redactProperties(principal, obj.objectTypeId, obj.properties);
  return Object.prototype.hasOwnProperty.call(redacted, property);
}

function toHit(
  catalog: ExploreCatalog,
  v: IndexValue,
  principal: string,
  authorizer?: OntologyAuthorizer,
): InvestigationIndexHit | undefined {
  const obj = catalog.objects.find((o) => o.id === v.objectId);
  if (!obj || obj.deleted) return undefined;
  if (authorizer && !authorizer.canReadObjectType(principal, obj.objectTypeId)) return undefined;
  if (!propertyVisible(obj, v.property, principal, authorizer)) return undefined;
  return {
    objectId: obj.id,
    objectTypeId: obj.objectTypeId,
    primaryKey: obj.primaryKey,
    snippet: v.text.slice(v.snippetOffset, v.snippetOffset + v.snippetLength),
  };
}

export function singleLevelSearch(
  catalog: ExploreCatalog,
  index: InvestigationIndex,
  token: string,
  principal: string,
  authorizer?: OntologyAuthorizer,
  limit = 20,
): InvestigationSearchResult {
  const key = token.toLowerCase();
  const values = index.single.get(key) ?? [];
  const hits: InvestigationIndexHit[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const hit = toHit(catalog, v, principal, authorizer);
    if (!hit || seen.has(hit.objectId)) continue;
    seen.add(hit.objectId);
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return { hits, total: hits.length, level: 'single' };
}

export function twoLevelSearch(
  catalog: ExploreCatalog,
  index: InvestigationIndex,
  token: string,
  rangeStart: string,
  rangeEnd: string,
  principal: string,
  authorizer?: OntologyAuthorizer,
  limit = 20,
): InvestigationSearchResult {
  const key = token.toLowerCase();
  const seconds = (index.first.get(key) ?? []).filter((k) => k >= rangeStart && k <= rangeEnd);
  const hits: InvestigationIndexHit[] = [];
  const seen = new Set<string>();
  for (const sk of seconds) {
    const v = index.second.get(sk);
    if (!v) continue;
    const hit = toHit(catalog, v, principal, authorizer);
    if (!hit || seen.has(hit.objectId)) continue;
    seen.add(hit.objectId);
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return { hits, total: hits.length, level: 'two' };
}
