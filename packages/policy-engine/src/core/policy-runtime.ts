/**
 * PolicyRuntime — one snapshot generation for compiled overlay EPID + native nodes.
 *
 * Invariants:
 * - authorize/filter/redact observe one generation (never a hybrid).
 * - Overlay wildcards are compiled to EPID nodes; authorize() only calls engine.authorize.
 * - Missing compiled node or EPID ⇒ deny (fail-closed).
 * - PolicyAdmin persists first, then swaps `published`. Persist/compile throw leaves generation unchanged.
 */

import type {
  AuthorizeFn,
  AuthorizeRequest,
  AuthorizeResult,
  PolicyEngine,
} from 'contracts';
import { allowsRead, canViewAtLevel } from 'contracts';

import { createPolicyEngine, type HydratablePolicyEngine } from './engine.js';
import {
  compileOverlayToEpid,
  mergeNativeAndCompiled,
} from './policy-compiler.js';
import {
  emptyCatalog,
  isEmptyCatalog,
  kernelCatalog,
  mergeCatalogs,
  catalogsEqual,
  parsePolicyCatalog,
  type PolicyResourceCatalog,
} from './policy-catalog.js';
import {
  ALLOW_ALL_POLICY_OVERLAY,
  cloneOverlay,
  DENY_ALL_POLICY_OVERLAY,
  EMPTY_POLICY_OVERLAY,
  overlayRedactProperties,
  parsePolicyOverlay,
  type PolicyOverlay,
} from './policy-overlay.js';
import {
  createMemoryPolicyStore,
  type PolicySnapshot,
  type PolicyStore,
} from './policy-store.js';
import { KERNEL_ONTOLOGY, qualifyResource, ResourceIds } from './resource-ids.js';
import type { Clock, IdGenerator } from './types.js';

/**
 * Frozen generation readers consume. WHY: assign as a whole so concurrent
 * authorize() cannot see new overlay with old EPID nodes.
 */
interface PublishedPolicy {
  generation: number;
  overlay: PolicyOverlay;
  catalog: PolicyResourceCatalog;
  engine: PolicyEngine;
}

/**
 * Frozen generation of overlay + EPID. All HTTP/Action decisions read this instance.
 */
export interface PolicyRuntime {
  /**
   * Fail-closed decision. Overlay-scheme resources are qualified and evaluated
   * only by the EPID engine of this generation.
   */
  authorize(req: AuthorizeRequest): AuthorizeResult;
  /** Drop unread / over-classified rows. Denied types are omitted (hidden-miss). */
  filterReadable<T extends { objectTypeId: string; ontologyId?: string }>(
    principal: string,
    records: readonly T[],
  ): T[];
  /** Apply overlay field masks. Must run before aggregate/count. */
  redactProperties<T extends Record<string, unknown>>(
    principal: string,
    objectTypeId: string,
    properties: T,
    ontologyId?: string,
  ): Partial<T>;
  explain(req: AuthorizeRequest): AuthorizeResult;
  generation(): number;
  /** True after a failed refresh; last valid generation is still served. */
  degraded(): boolean;
  /** Reload from store. On failure keeps the last generation and marks degraded. */
  refresh(): Promise<{ generation: number; changed: boolean; ok: boolean }>;
  /** Subscribe to store generation changes (and optional poll). Returns unsubscribe. */
  watch(opts?: { pollMs?: number }): () => void;
  close(): Promise<void>;
  /** Same function object injected into ActionExecutor. */
  readonly authorizeFn: AuthorizeFn;
  authorizeRead(principal: string, objectTypeId: string, ontologyId?: string): AuthorizeResult;
  authorizeMutation(principal: string, objectTypeId: string, ontologyId?: string): AuthorizeResult;
  authorizeAction(principal: string, actionApiName: string, ontologyId?: string): AuthorizeResult;
  explainDecision(req: AuthorizeRequest): AuthorizeResult;
  canReadObjectType(principal: string, objectTypeId: string, ontologyId?: string): boolean;
  canRunAction(principal: string, actionApiName: string, ontologyId?: string): boolean;
  /**
   * In-memory catalog swap + recompile. Store-backed runtimes should use PolicyAdmin.publishCatalog.
   * @throws if compile fails; generation unchanged.
   */
  recompileCatalog(catalog: PolicyResourceCatalog): void;
}

export type OntologyAuthorizer = PolicyRuntime;

export interface PolicyAdmin {
  /**
   * Validate overlay → compile against current catalog → persist snapshot → atomic publish.
   * @throws if persist/compile fails; generation is unchanged.
   */
  publishOverlay(overlay: PolicyOverlay): Promise<{ generation: number }>;
  /**
   * Compile current overlay against a new catalog → persist → atomic publish.
   * WHY: new ObjectType/Action is unauthorized until this generation swap.
   */
  publishCatalog(catalog: PolicyResourceCatalog): Promise<{ generation: number }>;
}

export interface CreatePolicyRuntimeOptions {
  store?: PolicyStore;
  overlay?: PolicyOverlay;
  catalog?: PolicyResourceCatalog;
  /** When store generation is 0 and overlay is set, persist compiled snapshot before returning. */
  persistOverlayIfEmpty?: boolean;
  clock?: Clock;
  nextId?: IdGenerator;
  onAudit?: (event: string, detail: Record<string, unknown>) => void | Promise<void>;
}

function nativeSlice(snap: PolicySnapshot): {
  grants: PolicySnapshot['grants'];
  nodes: PolicySnapshot['nodes'];
  epids: PolicySnapshot['epids'];
} {
  return { grants: snap.grants, nodes: snap.nodes, epids: snap.epids };
}

function engineFromSnapshot(
  snap: Pick<PolicySnapshot, 'grants' | 'nodes' | 'epids'>,
  opts: { clock?: Clock; nextId?: IdGenerator },
): HydratablePolicyEngine {
  // WHY: evaluator has no store — mutations go through PolicyAdmin only.
  const engine = createPolicyEngine({ clock: opts.clock, nextId: opts.nextId });
  for (const g of snap.grants) {
    engine.grantPolicy(g.principal, g.policy);
  }
  const pending = [...snap.nodes];
  const placed = new Set<string>();
  while (pending.length > 0) {
    const idx = pending.findIndex((n) => !n.parentId || placed.has(n.parentId));
    if (idx < 0) {
      throw new Error('policy snapshot has a parent cycle or missing parent');
    }
    const [node] = pending.splice(idx, 1);
    if (!node) throw new Error('policy snapshot node missing');
    engine.addNode({
      id: node.id,
      resourceId: node.resourceId,
      policy: node.policy,
      parentId: node.parentId,
    });
    placed.add(node.id);
  }
  return engine;
}

function compilePublished(
  overlay: PolicyOverlay,
  catalog: PolicyResourceCatalog,
  native: ReturnType<typeof nativeSlice>,
  generation: number,
  opts: { clock?: Clock; nextId?: IdGenerator },
): PublishedPolicy {
  const compiled = compileOverlayToEpid(overlay, catalog);
  const merged = mergeNativeAndCompiled(native, compiled);
  return {
    generation,
    overlay: cloneOverlay(overlay),
    catalog: mergeCatalogs(kernelCatalog(), catalog),
    engine: engineFromSnapshot(merged, opts),
  };
}

function decide(published: PublishedPolicy, req: AuthorizeRequest): AuthorizeResult {
  const qualified = qualifyResource(String(req.resource), req.operation);
  const result = published.engine.authorize({ ...req, resource: qualified });
  if (result.decision === 'deny') return result;
  if (req.context?.classification && published.overlay.maxClassification) {
    const max = published.overlay.maxClassification[req.principal];
    if (max && !canViewAtLevel(req.context.classification, max)) {
      return {
        decision: 'deny',
        principalEpids: result.principalEpids,
        resourceEpid: null,
        reason: `classification "${req.context.classification}" exceeds max "${max}"`,
      };
    }
  }
  return result;
}

function bindRuntime(
  getPublished: () => PublishedPolicy,
  setPublished: (next: PublishedPolicy) => void,
  closeFn: () => Promise<void>,
  extras: {
    degraded: () => boolean;
    refresh: () => Promise<{ generation: number; changed: boolean; ok: boolean }>;
    watch: (opts?: { pollMs?: number }) => () => void;
  } = {
    degraded: () => false,
    refresh: async () => {
      const g = getPublished().generation;
      return { generation: g, changed: false, ok: true };
    },
    watch: () => () => {
      /* no-op */
    },
  },
): PolicyRuntime {
  const authorizeFn: AuthorizeFn = (req) => decide(getPublished(), req);

  const runtime: PolicyRuntime = {
    authorizeFn,
    authorize: authorizeFn,
    filterReadable(principal, records) {
      const overlay = getPublished().overlay;
      const max = overlay.maxClassification?.[principal];
      return records.filter((r) => {
        const ontologyId =
          typeof r.ontologyId === 'string' && r.ontologyId.length > 0
            ? r.ontologyId
            : KERNEL_ONTOLOGY;
        const auth = authorizeFn({
          principal,
          resource: ResourceIds.objectType(ontologyId, r.objectTypeId),
          operation: 'read',
        });
        if (!allowsRead(auth)) return false;
        if (!max) return true;
        const marking = (r as { classification?: string }).classification;
        if (!marking) return true;
        return canViewAtLevel(marking, max);
      });
    },
    redactProperties(principal, objectTypeId, properties, ontologyId = KERNEL_ONTOLOGY) {
      return overlayRedactProperties(
        getPublished().overlay,
        principal,
        objectTypeId,
        properties,
        ontologyId,
      );
    },
    explain(req) {
      return authorizeFn(req);
    },
    generation() {
      return getPublished().generation;
    },
    degraded: extras.degraded,
    refresh: extras.refresh,
    watch: extras.watch,
    close: closeFn,
    authorizeRead(principal, objectTypeId, ontologyId = KERNEL_ONTOLOGY) {
      return authorizeFn({
        principal,
        resource: ResourceIds.objectType(ontologyId, objectTypeId),
        operation: 'read',
      });
    },
    authorizeMutation(principal, objectTypeId, ontologyId = KERNEL_ONTOLOGY) {
      return authorizeFn({
        principal,
        resource: ResourceIds.objectType(ontologyId, objectTypeId),
        operation: 'modify',
      });
    },
    authorizeAction(principal, actionApiName, ontologyId = KERNEL_ONTOLOGY) {
      return authorizeFn({
        principal,
        resource: ResourceIds.action(ontologyId, actionApiName),
        operation: 'modify',
      });
    },
    explainDecision(req) {
      return authorizeFn(req);
    },
    canReadObjectType(principal, objectTypeId, ontologyId = KERNEL_ONTOLOGY) {
      return allowsRead(
        authorizeFn({
          principal,
          resource: ResourceIds.objectType(ontologyId, objectTypeId),
          operation: 'read',
        }),
      );
    },
    canRunAction(principal, actionApiName, ontologyId = KERNEL_ONTOLOGY) {
      return (
        authorizeFn({
          principal,
          resource: ResourceIds.action(ontologyId, actionApiName),
          operation: 'modify',
        }).decision === 'allow'
      );
    },
    recompileCatalog(catalog) {
      const before = getPublished();
      const nextCatalog = mergeCatalogs(kernelCatalog(), catalog);
      if (catalogsEqual(before.catalog, nextCatalog)) return;
      try {
        const next = compilePublished(
          before.overlay,
          catalog,
          { grants: [], nodes: [], epids: [] },
          before.generation + 1,
          {},
        );
        setPublished(next);
      } catch (err) {
        setPublished(before);
        throw err;
      }
    },
  };
  return runtime;
}

export interface PolicyRuntimeBundle {
  policy: PolicyRuntime;
  admin: PolicyAdmin;
}

function catalogOf(opts: CreatePolicyRuntimeOptions, snap?: PolicySnapshot): PolicyResourceCatalog {
  // WHY: after the first persist, snap.catalog is the generation. opts.catalog is seed only.
  const stored = snap?.catalog ?? emptyCatalog();
  if (!isEmptyCatalog(stored)) return mergeCatalogs(kernelCatalog(), stored);
  return mergeCatalogs(kernelCatalog(), opts.catalog ?? emptyCatalog());
}

/**
 * Async factory. Returns only after overlay/EPID snapshot is loaded (and optionally persisted).
 */
export async function createPolicyRuntime(
  opts: CreatePolicyRuntimeOptions = {},
): Promise<PolicyRuntimeBundle> {
  const store = opts.store ?? createMemoryPolicyStore();
  let closed = false;

  if (opts.persistOverlayIfEmpty && opts.overlay) {
    const gen = await store.getGeneration();
    const snap = await store.snapshot();
    const emptyOverlay =
      snap.overlay.grants.length === 0 && Object.keys(snap.overlay.roles).length === 0;
    if (gen === 0 && emptyOverlay) {
      const overlay = cloneOverlay(opts.overlay);
      const catalog = catalogOf(opts, snap);
      const compiled = compileOverlayToEpid(overlay, catalog);
      const merged = mergeNativeAndCompiled(nativeSlice(snap), compiled);
        await store.replaceSnapshot({
          grants: merged.grants,
          nodes: merged.nodes,
          epids: merged.epids,
          overlay,
          catalog,
        }, snap.generation);
    }
  }

  const loadPublished = async (): Promise<PublishedPolicy> => {
    const snap = await store.snapshot();
    const overlay = cloneOverlay(snap.overlay);
    const catalog = catalogOf(opts, snap);
    return compilePublished(overlay, catalog, nativeSlice(snap), snap.generation, opts);
  };

  let published = await loadPublished();
  if (
    opts.overlay &&
    !opts.store &&
    published.overlay.grants.length === 0 &&
    Object.keys(published.overlay.roles).length === 0 &&
    !published.overlay.everyoneRole
  ) {
    const overlay = cloneOverlay(opts.overlay);
    const catalog = catalogOf(opts);
    published = compilePublished(
      overlay,
      catalog,
      { grants: [], nodes: [], epids: [] },
      published.generation,
      opts,
    );
  }

  const getPublished = (): PublishedPolicy => published;
  let degraded = false;
  let stopWatch: (() => void) | undefined;

  await store.startNotifications?.();

  const extras = {
    degraded: () => degraded,
    async refresh() {
      try {
        const next = await loadPublished();
        const changed = next.generation !== published.generation;
        published = next;
        degraded = false;
        return { generation: published.generation, changed, ok: true };
      } catch {
        degraded = true;
        return { generation: published.generation, changed: false, ok: false };
      }
    },
    watch(opts?: { pollMs?: number }) {
      const unsubStore = store.subscribeGeneration
        ? store.subscribeGeneration(() => {
            void extras.refresh();
          })
        : () => {
            /* no store subscription */
          };
      let timer: ReturnType<typeof setInterval> | undefined;
      if (opts?.pollMs && opts.pollMs > 0) {
        timer = setInterval(() => {
          void extras.refresh();
        }, opts.pollMs);
      }
      return () => {
        unsubStore();
        if (timer) clearInterval(timer);
      };
    },
  };

  const admin: PolicyAdmin = {
    async publishOverlay(overlay: PolicyOverlay) {
      if (closed) throw new Error('policy runtime is closed');
      parsePolicyOverlay(overlay);
      const before = published;
      try {
        const current = await store.snapshot();
        const catalog = mergeCatalogs(kernelCatalog(), current.catalog, opts.catalog ?? emptyCatalog());
        const compiled = compileOverlayToEpid(overlay, catalog);
        const merged = mergeNativeAndCompiled(nativeSlice(current), compiled);
        await store.replaceSnapshot(
          {
            grants: merged.grants,
            nodes: merged.nodes,
            epids: merged.epids,
            overlay: cloneOverlay(overlay),
            catalog,
          },
          current.generation,
        );
        published = await loadPublished();
        degraded = false;
      } catch (err) {
        published = before;
        throw err;
      }
      await opts.onAudit?.('policy.publishOverlay', { generation: published.generation });
      return { generation: published.generation };
    },
    async publishCatalog(catalog: PolicyResourceCatalog) {
      if (closed) throw new Error('policy runtime is closed');
      const before = published;
      try {
        const current = await store.snapshot();
        const overlay = cloneOverlay(current.overlay);
        const nextCatalog = mergeCatalogs(kernelCatalog(), catalog);
        if (catalogsEqual(mergeCatalogs(kernelCatalog(), current.catalog), nextCatalog)) {
          return { generation: current.generation };
        }
        const compiled = compileOverlayToEpid(overlay, nextCatalog);
        const merged = mergeNativeAndCompiled(nativeSlice(current), compiled);
        await store.replaceSnapshot(
          {
            grants: merged.grants,
            nodes: merged.nodes,
            epids: merged.epids,
            overlay,
            catalog: nextCatalog,
          },
          current.generation,
        );
        published = await loadPublished();
        degraded = false;
      } catch (err) {
        published = before;
        throw err;
      }
      await opts.onAudit?.('policy.publishCatalog', { generation: published.generation });
      return { generation: published.generation };
    },
  };

  stopWatch = extras.watch();
  const policy = bindRuntime(
    getPublished,
    (next) => {
      published = next;
    },
    async () => {
      closed = true;
      stopWatch?.();
      await store.stopNotifications?.();
    },
    extras,
  );

  return { policy, admin };
}

export interface OverlayRuntimeOptions {
  catalog?: PolicyResourceCatalog;
}

/**
 * Sync fixture compiler. No I/O. Used by createOntologyAuthorizer and tests.
 */
export function createPolicyRuntimeFromOverlay(
  overlay: PolicyOverlay,
  opts: OverlayRuntimeOptions = {},
): PolicyRuntime {
  const catalog = mergeCatalogs(kernelCatalog(), opts.catalog ?? emptyCatalog());
  let frozen = compilePublished(
    overlay,
    catalog,
    { grants: [], nodes: [], epids: [] },
    0,
    {},
  );
  return bindRuntime(
    () => frozen,
    (next) => {
      frozen = next;
    },
    async () => {
      /* no resources */
    },
  );
}

export function createOntologyAuthorizer(
  config: PolicyOverlay,
  opts?: OverlayRuntimeOptions,
): PolicyRuntime {
  return createPolicyRuntimeFromOverlay(config, opts);
}

/**
 * Named test/demo fixture. Compiles ALLOW_ALL against kernel admin + optional catalog.
 * Never an implicit production default.
 */
export function createAllowAllTestPolicy(catalog?: PolicyResourceCatalog): PolicyRuntime {
  return createPolicyRuntimeFromOverlay(ALLOW_ALL_POLICY_OVERLAY, { catalog });
}

export function createDenyAllAuthorizer(): PolicyRuntime {
  return createPolicyRuntimeFromOverlay(DENY_ALL_POLICY_OVERLAY);
}

export type OntologyAuthorizerConfig = PolicyOverlay;
export type { OntologyGrant, OverlayOp, PolicyOverlay } from './policy-overlay.js';
export {
  ALLOW_ALL_POLICY_OVERLAY,
  DENY_ALL_POLICY_OVERLAY,
  EMPTY_POLICY_OVERLAY,
};
export { parsePolicyCatalog };
