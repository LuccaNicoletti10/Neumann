/**
 * federation — src/core/engine.ts
 * Orquestra planner → pushdown → TemporaryObject → promote opcional.
 *
 * T1.5: a fonte permanece a única cópia durável até promote.
 */

import {
  assertPushdownSpec,
  isPlatformObject,
  isTemporaryObject,
  type DataFragment,
  type FederatedLink,
  type FederatedPromotion,
  type FederatedScript,
  type FederatedView,
  type FederationPlan,
  type FederationPrincipal,
  type FederationQuery,
  type FederationSourceCatalogEntry,
  type PlatformObject,
  type TemporaryObject,
} from 'contracts';

import { aggregateAcl, redactTemporaryObject } from './acl.js';
import { addMs, isAfter, type Clock, type IdGenerator } from './determinism.js';
import { planFederation } from './planner.js';
import { createDefaultFederatedScript } from './script.js';
import type { MemoryFederatedConnector } from './memory-source.js';

export interface FederatedSourceBinding {
  catalog: FederationSourceCatalogEntry;
  connector: MemoryFederatedConnector;
}

export interface FederationEngine {
  registerSource(binding: FederatedSourceBinding): void;
  registerScript(script: FederatedScript): void;
  plan(query: FederationQuery): FederationPlan;
  execute(query: FederationQuery, principal: FederationPrincipal): TemporaryObject[];
  loadTemporaryObject(
    objectId: string,
    principal: FederationPrincipal,
    scriptId?: string,
  ): TemporaryObject | PlatformObject | null;
  searchFragments(objectId: string): DataFragment[];
  promote(
    objectId: string,
    principal: FederationPrincipal,
    scriptId?: string,
  ): PlatformObject | null;
  applyPromotion(objectId: string, promotion: FederatedPromotion): void;
  refresh(objectId: string, scriptId?: string): void;
  displayLink(objectId: string, targetId: string, linkType: string): FederatedLink;
  getTempObject(objectId: string): TemporaryObject | undefined;
  getPlatformObject(objectId: string): PlatformObject | undefined;
  isMaterialized(objectId: string): boolean;
  /** T1.5: true se a fonte ainda é a única cópia durável. */
  sourceHoldsExclusiveCopy(objectId: string): boolean;
  snapshotCallCount(): number;
  purgeExpired(): void;
}

export interface CreateFederationEngineOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  ttlMs?: number;
}

function applyEdit(target: { properties: Record<string, unknown>; links: FederatedLink[] }, promotion: FederatedPromotion): void {
  if (promotion.type === 'addProperty' || promotion.type === 'updateProperty') {
    target.properties[promotion.key] = promotion.value;
  } else {
    target.links.push({ targetId: promotion.targetId, linkType: promotion.linkType });
  }
}

export function createFederationEngine(
  opts: CreateFederationEngineOptions = {},
): FederationEngine {
  const clock = opts.clock ?? ((): string => new Date().toISOString());
  const ttlMs = opts.ttlMs ?? 60_000;

  const sources = new Map<string, FederatedSourceBinding>();
  const scripts = new Map<string, FederatedScript>();
  const tempCache = new Map<string, TemporaryObject>();
  const platformStore = new Map<string, PlatformObject>();

  scripts.set('default', createDefaultFederatedScript());

  function catalog(): FederationSourceCatalogEntry[] {
    return [...sources.values()].map((s) => s.catalog);
  }

  function requireScript(id: string): FederatedScript {
    const script = scripts.get(id);
    if (!script) throw new Error(`script não encontrado: ${id}`);
    return script;
  }

  function latestUpdated(fragments: DataFragment[], fallback: string): string {
    let max = fallback;
    for (const f of fragments) {
      if (isAfter(f.lastUpdated, max)) max = f.lastUpdated;
    }
    return max;
  }

  function searchFragments(objectId: string): DataFragment[] {
    const out: DataFragment[] = [];
    for (const [sourceId, binding] of sources) {
      const spec = {
        object: { sourceSystem: sourceId, objectName: binding.catalog.objectName },
        primaryKeys: [objectId],
        columns: [...binding.catalog.fields],
      };
      assertPushdownSpec(spec);
      const result = binding.connector.federatedQuerySync(spec);
      if (result.copied) throw new Error('T1.5: federatedQuery não pode copiar a fonte');
      for (const row of result.rows) {
        out.push({
          id: row.fragmentId,
          objectId: row.objectId,
          sourceSystemId: sourceId,
          objectName: binding.catalog.objectName,
          rawData: { ...row.fields },
          lastUpdated: row.lastUpdated,
          acl: row.acl,
        });
      }
    }
    return out;
  }

  function buildTemporaryObject(
    objectId: string,
    fragments: DataFragment[],
    scriptId: string,
    now: string,
  ): TemporaryObject {
    const script = requireScript(scriptId);
    const temp = script.mergeFragments(fragments);
    temp.id = objectId;
    temp.objectTypeId = script.objectTypeId;
    temp.fragments = fragments;
    temp.promoted = platformStore.has(objectId);
    temp.copyOnWrite = true;
    temp.provenance = temp.promoted ? 'promoted' : 'federated';
    temp.acl = aggregateAcl(fragments, now);
    temp.expiresAt = addMs(now, ttlMs);
    const existing = tempCache.get(objectId);
    if (existing?.promotionMetadata) {
      temp.promotionMetadata = {
        ...existing.promotionMetadata,
        fragmentIds: fragments.map((f) => f.id),
      };
      for (const key of existing.promotionMetadata.promotedProperties) {
        if (existing.properties[key] !== undefined) {
          temp.properties[key] = existing.properties[key];
        }
      }
      temp.links = [...temp.links, ...existing.promotionMetadata.promotedLinks];
    }
    return temp;
  }

  function purgeExpired(): void {
    const now = clock();
    for (const [id, temp] of tempCache) {
      if (!temp.promoted && isAfter(now, temp.expiresAt)) tempCache.delete(id);
    }
  }

  function loadUnredacted(objectId: string, scriptId: string): TemporaryObject | PlatformObject | null {
    purgeExpired();
    const now = clock();
    const fragments = searchFragments(objectId);
    if (fragments.length === 0 && !tempCache.has(objectId) && !platformStore.has(objectId)) {
      return null;
    }

    if (fragments.length > 0) {
      const cached = tempCache.get(objectId);
      const latest = latestUpdated(fragments, now);
      if (!cached || isAfter(latest, cached.expiresAt) || isAfter(latest, cached.promotionMetadata?.promotedAt ?? '1970-01-01T00:00:00.000Z')) {
        const temp = buildTemporaryObject(objectId, fragments, scriptId, now);
        tempCache.set(objectId, temp);
      }
    }

    const platform = platformStore.get(objectId);
    if (platform) return platform;
    return tempCache.get(objectId) ?? null;
  }

  return {
    registerSource(binding) {
      sources.set(binding.catalog.sourceId, binding);
    },
    registerScript(script) {
      scripts.set(script.id, script);
    },
    plan(query) {
      return planFederation(query, catalog());
    },

    searchFragments,

    execute(query, principal) {
      purgeExpired();
      const plan = planFederation(query, catalog());
      const byObject = new Map<string, DataFragment[]>();
      for (const step of plan.pushdowns) {
        const binding = sources.get(step.sourceId);
        if (!binding) continue;
        assertPushdownSpec(step.spec);
        const result = binding.connector.federatedQuerySync(step.spec);
        if (result.copied) throw new Error('T1.5: federatedQuery não pode copiar a fonte');
        for (const row of result.rows) {
          const list = byObject.get(row.objectId) ?? [];
          list.push({
            id: row.fragmentId,
            objectId: row.objectId,
            sourceSystemId: step.sourceId,
            objectName: binding.catalog.objectName,
            rawData: { ...row.fields },
            lastUpdated: row.lastUpdated,
            acl: row.acl,
          });
          byObject.set(row.objectId, list);
        }
      }

      const now = clock();
      const out: TemporaryObject[] = [];
      for (const [objectId, fragments] of byObject) {
        const temp = buildTemporaryObject(objectId, fragments, plan.scriptId, now);
        tempCache.set(objectId, temp);
        out.push(redactTemporaryObject(temp, principal));
      }
      return out;
    },

    loadTemporaryObject(objectId, principal, scriptId = 'default') {
      const loaded = loadUnredacted(objectId, scriptId);
      if (!loaded) return null;
      if (isTemporaryObject(loaded)) return redactTemporaryObject(loaded, principal);
      const temp = tempCache.get(objectId);
      if (temp) return redactTemporaryObject(temp, principal);
      return loaded;
    },

    promote(objectId, principal, scriptId = 'default') {
      let temp = tempCache.get(objectId);
      if (!temp) {
        const loaded = loadUnredacted(objectId, scriptId);
        if (!loaded) return null;
        if (isPlatformObject(loaded)) return loaded;
        temp = loaded;
      }
      if (temp.promoted) return platformStore.get(objectId) ?? null;

      const now = clock();
      const script = requireScript(scriptId);
      const platform = script.toPlatformObject(temp, now);
      platform.sourceFragments = temp.fragments;
      platform.promotionMetadata = {
        fragmentIds: temp.fragments.map((f) => f.id),
        promotedProperties: [...(temp.promotionMetadata?.promotedProperties ?? [])],
        promotedLinks: [...(temp.promotionMetadata?.promotedLinks ?? [])],
        promotedAt: now,
        promotedBy: principal.id,
      };
      platform.acl = temp.acl;
      platform.copyOnWrite = true;
      platform.createdAt = now;
      platform.updatedAt = now;
      platformStore.set(objectId, platform);
      temp.promoted = true;
      temp.provenance = 'promoted';
      temp.promotionMetadata = platform.promotionMetadata;
      tempCache.set(objectId, temp);
      return platform;
    },

    applyPromotion(objectId, promotion) {
      let temp = tempCache.get(objectId);
      if (!temp) {
        const loaded = loadUnredacted(objectId, 'default');
        if (!loaded) throw new Error(`objeto ${objectId} não encontrado`);
        if (isPlatformObject(loaded)) {
          applyEdit(loaded, promotion);
          loaded.updatedAt = clock();
          if (promotion.type === 'addProperty' || promotion.type === 'updateProperty') {
            if (!loaded.promotionMetadata.promotedProperties.includes(promotion.key)) {
              loaded.promotionMetadata.promotedProperties.push(promotion.key);
            }
          } else {
            loaded.promotionMetadata.promotedLinks.push({
              targetId: promotion.targetId,
              linkType: promotion.linkType,
            });
          }
          platformStore.set(objectId, loaded);
          return;
        }
        temp = loaded;
      }

      applyEdit(temp, promotion);
      temp.promotionMetadata ??= {
        fragmentIds: temp.fragments.map((f) => f.id),
        promotedProperties: [],
        promotedLinks: [],
        promotedAt: clock(),
        promotedBy: 'user',
      };
      if (promotion.type === 'addProperty' || promotion.type === 'updateProperty') {
        if (!temp.promotionMetadata.promotedProperties.includes(promotion.key)) {
          temp.promotionMetadata.promotedProperties.push(promotion.key);
        }
      } else {
        const link = { targetId: promotion.targetId, linkType: promotion.linkType };
        temp.promotionMetadata.promotedLinks.push(link);
      }
      tempCache.set(objectId, temp);

      if (temp.promoted) {
        const platform = platformStore.get(objectId);
        if (platform) {
          applyEdit(platform, promotion);
          platform.updatedAt = clock();
          platform.promotionMetadata = temp.promotionMetadata;
          platformStore.set(objectId, platform);
        }
      }
    },

    refresh(objectId, scriptId = 'default') {
      const platform = platformStore.get(objectId);
      if (!platform) return;
      const fragments = searchFragments(objectId);
      if (fragments.length === 0) return;
      const latest = latestUpdated(fragments, platform.updatedAt);
      if (!isAfter(latest, platform.updatedAt)) return;

      const now = clock();
      const userProps: Record<string, unknown> = {};
      for (const key of platform.promotionMetadata.promotedProperties) {
        if (platform.properties[key] !== undefined) userProps[key] = platform.properties[key];
      }
      const userLinks = [...platform.promotionMetadata.promotedLinks];
      const temp = buildTemporaryObject(objectId, fragments, scriptId, now);
      Object.assign(temp.properties, userProps);
      temp.links.push(...userLinks);
      temp.promoted = true;
      temp.provenance = 'promoted';
      temp.promotionMetadata = {
        ...platform.promotionMetadata,
        fragmentIds: fragments.map((f) => f.id),
      };

      const script = requireScript(scriptId);
      const next = script.toPlatformObject(temp, now);
      next.promotionMetadata = temp.promotionMetadata;
      next.sourceFragments = fragments;
      next.acl = temp.acl;
      next.copyOnWrite = true;
      next.createdAt = platform.createdAt;
      next.updatedAt = now;
      platformStore.set(objectId, next);
      tempCache.set(objectId, temp);
    },

    displayLink(objectId, targetId, linkType) {
      const known =
        tempCache.has(targetId) ||
        platformStore.has(targetId) ||
        [...sources.values()].some((s) => s.connector.records.has(targetId));
      const link: FederatedLink = {
        targetId,
        linkType,
        absentFromStore: !known,
      };
      const temp = tempCache.get(objectId);
      if (temp && !temp.links.some((l) => l.targetId === targetId && l.linkType === linkType)) {
        temp.links.push(link);
        tempCache.set(objectId, temp);
      }
      const platform = platformStore.get(objectId);
      if (platform && !platform.links.some((l) => l.targetId === targetId && l.linkType === linkType)) {
        platform.links.push(link);
        platformStore.set(objectId, platform);
      }
      return link;
    },

    getTempObject(objectId) {
      purgeExpired();
      return tempCache.get(objectId);
    },
    getPlatformObject(objectId) {
      return platformStore.get(objectId);
    },
    isMaterialized(objectId) {
      return platformStore.has(objectId);
    },
    sourceHoldsExclusiveCopy(objectId) {
      if (platformStore.has(objectId)) return false;
      return [...sources.values()].some((s) => s.connector.records.has(objectId));
    },
    snapshotCallCount() {
      let n = 0;
      for (const s of sources.values()) n += s.connector.snapshotCallCount;
      return n;
    },
    purgeExpired,
  };
}

export type { FederatedView };
