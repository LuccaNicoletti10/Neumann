/**
 * query-api — src/core/engine.ts
 * Índice permission-aware + Ontology Query Planner.
 *
 * Backends: search-index | object-store | graph | federation (Passo 31).
 */

import {
  assertSearchDocument,
  assertSearchQuery,
  canViewAtLevel,
  type SearchBackend,
  type SearchDocument,
  type SearchLink,
  type SearchPrincipal,
  type SearchQuery,
  type SearchResponse,
  type SearchTemplate,
} from 'contracts';

import { canViewDocument, canViewProperty } from './acl.js';
import { createDeterministicClock, createIdGenerator, freshnessLagMs, type Clock, type IdGenerator } from './determinism.js';
import { matchesFilter } from './filter.js';
import { keyPhrases } from './key-phrases.js';
import { applyTemplate } from './templates.js';
import { stringifyValue, tokenize } from './tokenize.js';
import {
  buildAutocomplete,
  buildFacets,
  buildSuggestions,
  rankHits,
  toHit,
} from './surfaces.js';

export interface QueryEngine {
  upsert(doc: SearchDocument): SearchDocument;
  remove(id: string): void;
  upsertLink(link: Omit<SearchLink, 'id'> & { id?: string }): SearchLink;
  registerTemplate(template: SearchTemplate): void;
  execute(query: SearchQuery, principal: SearchPrincipal): SearchResponse;
  keyPhrases(principal: SearchPrincipal, limit?: number): string[];
  /** Max lag indexedAt − sourceUpdatedAt across the index. */
  indexFreshnessLagMs(): number;
}

export type FederateFn = (query: SearchQuery, principal: SearchPrincipal) => SearchDocument[];

export interface CreateQueryEngineOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Pushdown federado (Passo 31). Sem adapter → hits vazios, backend federation. */
  federate?: FederateFn;
}

interface Posting {
  docId: string;
  property: string;
}

function planBackend(query: SearchQuery): SearchBackend {
  if (query.federate) return 'federation';
  if (query.searchAround) return 'graph';
  if (query.q && query.q.trim()) return 'search-index';
  return 'object-store';
}

export function createQueryEngine(opts: CreateQueryEngineOptions = {}): QueryEngine {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const { federate } = opts;

  const docs = new Map<string, SearchDocument>();
  const inverted = new Map<string, Posting[]>();
  const templates = new Map<string, SearchTemplate>();
  const searchLinks = new Map<string, SearchLink>();

  function reindex(doc: SearchDocument): void {
    for (const [tok, postings] of inverted) {
      const next = postings.filter((p) => p.docId !== doc.id);
      if (next.length === 0) inverted.delete(tok);
      else inverted.set(tok, next);
    }
    for (const [prop, raw] of Object.entries(doc.properties)) {
      const text = stringifyValue(raw);
      if (!text) continue;
      for (const tok of new Set(tokenize(text))) {
        const list = inverted.get(tok) ?? [];
        list.push({ docId: doc.id, property: prop });
        inverted.set(tok, list);
      }
    }
    for (const tok of new Set(tokenize(doc.primaryKey))) {
      const list = inverted.get(tok) ?? [];
      list.push({ docId: doc.id, property: '_pk' });
      inverted.set(tok, list);
    }
  }

  function authorized(user: SearchPrincipal): SearchDocument[] {
    return [...docs.values()].filter((d) => canViewDocument(d, user));
  }

  function tokenVisible(post: Posting, user: SearchPrincipal): boolean {
    const doc = docs.get(post.docId);
    if (!doc) return false;
    if (post.property === '_pk') return canViewDocument(doc, user);
    return canViewProperty(doc, post.property, user);
  }

  function byText(q: string, user: SearchPrincipal): SearchDocument[] {
    const toks = tokenize(q);
    if (toks.length === 0) return authorized(user);
    let ids: Set<string> | undefined;
    for (const tok of toks) {
      const hits = new Set<string>();
      for (const p of inverted.get(tok) ?? []) {
        if (tokenVisible(p, user)) hits.add(p.docId);
      }
      if (!ids) {
        ids = hits;
      } else {
        const next = new Set<string>();
        for (const id of ids) {
          if (hits.has(id)) next.add(id);
        }
        ids = next;
      }
    }
    const out: SearchDocument[] = [];
    for (const id of ids ?? new Set<string>()) {
      const doc = docs.get(id);
      if (doc && canViewDocument(doc, user)) out.push(doc);
    }
    return out;
  }

  function applyTypeAndFilter(
    candidates: SearchDocument[],
    query: SearchQuery,
    user: SearchPrincipal,
  ): SearchDocument[] {
    let rows = candidates;
    if (query.objectTypeIds?.length) {
      const types = new Set(query.objectTypeIds);
      rows = rows.filter((d) => types.has(String(d.objectTypeId)));
    }
    if (query.filter) {
      rows = rows.filter((d) => matchesFilter(d, query.filter!, user));
    }
    return rows;
  }

  function resolveQuery(
    query: SearchQuery,
    user: SearchPrincipal,
  ): { backend: SearchBackend; docs: SearchDocument[] } {
    let q = { ...query };
    if (q.templateId) {
      const tpl = templates.get(q.templateId);
      if (!tpl) throw new Error(`template não encontrado: ${q.templateId}`);
      if (tpl.viewingLevel && !canViewAtLevel(tpl.viewingLevel, user.viewingLevel)) {
        return { backend: 'object-store', docs: [] };
      }
      q = {
        ...q,
        objectTypeIds: q.objectTypeIds ?? [tpl.objectTypeId],
        filter: applyTemplate(tpl, q.templateParams ?? {}),
      };
    }

    const backend = planBackend(q);

    if (backend === 'federation') {
      const remote = federate?.(q, user) ?? [];
      return { backend, docs: applyTypeAndFilter(remote, q, user) };
    }

    if (backend === 'graph' && q.searchAround) {
      const around = q.searchAround;
      const start = docs.get(around.objectId);
      if (!start || !canViewDocument(start, user)) {
        return { backend, docs: [] };
      }
      const maxHops = around.maxHops ?? 1;
      const typeFilter = around.linkTypeId;
      const visited = new Set<string>([around.objectId]);
      let frontier = [around.objectId];
      const neighbors: SearchDocument[] = [];
      let depth = 0;
      while (frontier.length > 0 && depth < maxHops) {
        depth += 1;
        const next: string[] = [];
        for (const fromId of frontier) {
          for (const link of searchLinks.values()) {
            if (link.sourceObjectId !== fromId) continue;
            if (typeFilter && link.linkTypeId !== typeFilter) continue;
            if (visited.has(link.targetObjectId)) continue;
            visited.add(link.targetObjectId);
            const doc = docs.get(link.targetObjectId);
            if (!doc || !canViewDocument(doc, user)) continue;
            if (user.viewingLevel && doc.classification && !canViewAtLevel(doc.classification, user.viewingLevel)) {
              continue;
            }
            neighbors.push(doc);
            next.push(link.targetObjectId);
          }
        }
        frontier = next;
      }
      return { backend, docs: applyTypeAndFilter(neighbors, q, user) };
    }

    const pool = backend === 'search-index' && q.q ? byText(q.q, user) : authorized(user);
    return { backend, docs: applyTypeAndFilter(pool, q, user) };
  }

  return {
    upsert(input) {
      assertSearchDocument(input);
      const doc: SearchDocument = {
        ...input,
        properties: { ...input.properties },
        aclPrincipals: [...input.aclPrincipals],
        indexedAt: clock(),
      };
      docs.set(doc.id, doc);
      reindex(doc);
      return doc;
    },

    remove(id) {
      const existing = docs.get(id);
      if (!existing) return;
      docs.delete(id);
      for (const [tok, postings] of inverted) {
        const next = postings.filter((p) => p.docId !== id);
        if (next.length === 0) inverted.delete(tok);
        else inverted.set(tok, next);
      }
    },

    upsertLink(input) {
      const link: SearchLink = {
        id: input.id ?? nextId('slink'),
        linkTypeId: input.linkTypeId,
        sourceObjectId: input.sourceObjectId,
        targetObjectId: input.targetObjectId,
      };
      const key = `${link.linkTypeId}|${link.sourceObjectId}|${link.targetObjectId}`;
      searchLinks.set(key, link);
      return link;
    },

    registerTemplate(template) {
      templates.set(template.id, template);
    },

    execute(query, principal) {
      assertSearchQuery(query);
      const t0 = Date.now();
      const { backend, docs: matched } = resolveQuery(query, principal);
      const limit = query.limit ?? 20;
      const hits = rankHits(
        matched.map((d) => toHit(d, principal, query.q)),
        limit,
      );
      const lag = matched.reduce(
        (m, d) => Math.max(m, freshnessLagMs(d.indexedAt ?? d.sourceUpdatedAt, d.sourceUpdatedAt)),
        0,
      );
      return {
        hits,
        total: matched.length,
        facets: buildFacets(matched, principal, query.facetFields ?? []),
        suggestions: buildSuggestions(hits),
        autocomplete: buildAutocomplete(matched, principal, query.q),
        metadata: {
          backend,
          tookMs: Date.now() - t0,
          freshnessLagMs: lag,
        },
      };
    },

    keyPhrases(principal, limit = 8) {
      return keyPhrases(authorized(principal), principal, limit);
    },

    indexFreshnessLagMs() {
      let max = 0;
      for (const d of docs.values()) {
        max = Math.max(max, freshnessLagMs(d.indexedAt ?? d.sourceUpdatedAt, d.sourceUpdatedAt));
      }
      return max;
    },
  };
}
