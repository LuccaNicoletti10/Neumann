/**
 * action-engine — src/core/executor.ts
 * Generic ActionExecutor. Production mutations run inside UnitOfWork.
 */

import type {
  ActionApplyRequest,
  ActionApplyResult,
  ActionDefinitionResolver,
  ActionExecution,
  ActionExecutor,
  ActionParameterTree,
  ActionRule,
  ActionSideEffect,
  ActionSubmissionCriterion,
  ActionTypeDef,
  ActionValidateRequest,
  ActionValidateResult,
  ObjectRecord,
  OntologyId,
  OperationalEventKind,
  ResolvedActionDefinition,
} from 'contracts';
import { allowsMutation } from 'contracts';

import {
  createSystemClock,
  createUuidIdGenerator,
} from 'object-platform';
import { createAuditLog } from 'policy-engine';
import { ResourceIds } from 'policy-engine';

import {
  createOntologyActionResolver,
  resolveActionByApiName,
} from './action-definition-resolver.js';
import {
  assertActionTransition,
  isTerminalStatus,
  transitionExecution,
} from './action-lifecycle.js';
import { buildActionRequestIdentity } from './action-request-identity.js';
import { validateActionParameters } from './action-parameter-validator.js';
import {
  renderDocumentTemplate,
  templateContextFrom,
} from './document-template.js';
import { createMemoryActionExecutionStore } from './execution-store.js';
import { createMemoryOperationalEventStore } from './events.js';
import { buildParameterTree } from './parameter-tree.js';
import type {
  ActionTransactionStores,
  CreateActionExecutorOptions,
} from './types.js';

function apiNameOf(def: ActionTypeDef): string {
  return def.apiName ?? def.id;
}

function paramValue(
  params: Record<string, unknown>,
  name: string,
): unknown {
  return params[name];
}

async function asValue<T>(v: T | Promise<T>): Promise<T> {
  return await v;
}

function evaluateCriterion(
  criterion: ActionSubmissionCriterion,
  params: Record<string, unknown>,
  objects: Map<string, ObjectRecord>,
): boolean {
  if (criterion.kind === 'always') return true;
  if (criterion.kind === 'object_exists') {
    const pk = String(paramValue(params, criterion.primaryKeyParam ?? '') ?? '');
    const key = `${criterion.objectTypeId}::${pk}`;
    return objects.has(key);
  }
  if (criterion.kind === 'property_equals' || criterion.kind === 'property_in') {
    const pk = String(paramValue(params, criterion.primaryKeyParam ?? '') ?? '');
    const obj = objects.get(`${criterion.objectTypeId}::${pk}`);
    if (!obj || !criterion.propertyTypeId) return false;
    const val = obj.properties[criterion.propertyTypeId];
    if (criterion.kind === 'property_equals') return val === criterion.equals;
    return (criterion.inValues ?? []).includes(val as never);
  }
  return false;
}

function resultOf(execution: ActionExecution): ActionApplyResult {
  return {
    executionId: execution.id,
    status: execution.status,
    actionTypeId: execution.actionTypeId,
    result: execution.result,
    error: execution.error,
    auditEntryId: execution.auditEntryId,
  };
}

function isMutatingAction(def: ActionTypeDef): boolean {
  return (def.rules ?? []).some(
    (r) =>
      r.kind === 'create_object' ||
      r.kind === 'modify_object' ||
      r.kind === 'delete_object' ||
      r.kind === 'create_link' ||
      r.kind === 'delete_link' ||
      r.kind === 'generate_document',
  );
}

function needsExpectedVersions(def: ActionTypeDef): boolean {
  return (def.rules ?? []).some(
    (r) =>
      r.kind === 'modify_object' ||
      r.kind === 'delete_object' ||
      r.kind === 'delete_link' ||
      r.kind === 'generate_document',
  );
}

export function createActionExecutor(
  opts: CreateActionExecutorOptions,
): ActionExecutor {
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();
  if (opts.mode === 'production') {
    if (!opts.audit || !opts.events || !opts.executions) {
      throw new Error(
        'production ActionExecutor requires durable audit, events, and execution stores',
      );
    }
  }
  const authorize = opts.authorize;
  if (!authorize) {
    throw new Error(
      'ActionExecutor requires authorize (fail-closed; tests use createAllowAllTestPolicy)',
    );
  }
  if (!opts.ontology) {
    throw new Error(
      'ActionExecutor requires ontology (ActionType is not a local cache)',
    );
  }
  const ontology = opts.ontology;
  const resolver: ActionDefinitionResolver =
    opts.resolver ?? createOntologyActionResolver(ontology);
  const policyGeneration = opts.policyGeneration ?? (() => 0);
  const defaultStores: ActionTransactionStores = {
    objects: opts.objects,
    links: opts.links,
    audit: opts.audit ?? createAuditLog({ clock, nextId }),
    events: opts.events ?? createMemoryOperationalEventStore({ clock, nextId }),
    executions: opts.executions ?? createMemoryActionExecutionStore(),
    outbox: opts.outbox,
  };

  async function resolveByApiName(
    ontologyId: OntologyId,
    apiName: string,
    ontologyVersionId?: string,
  ): Promise<ResolvedActionDefinition | undefined> {
    return resolveActionByApiName(
      ontology,
      resolver,
      ontologyId,
      apiName,
      ontologyVersionId,
    );
  }

  async function loadReferencedObjects(
    objects: ActionTransactionStores['objects'],
    def: ActionTypeDef,
    params: Record<string, unknown>,
    ontologyId: OntologyId,
  ): Promise<Map<string, ObjectRecord>> {
    const map = new Map<string, ObjectRecord>();
    const candidates: { objectTypeId: string; pkParam: string }[] = [];

    for (const [name, p] of Object.entries(def.parameters ?? {})) {
      if (p.baseType === 'object_reference' && p.objectTypeId) {
        candidates.push({ objectTypeId: p.objectTypeId, pkParam: name });
      }
    }
    for (const c of def.submissionCriteria ?? []) {
      if (c.objectTypeId && c.primaryKeyParam) {
        candidates.push({ objectTypeId: c.objectTypeId, pkParam: c.primaryKeyParam });
      }
    }
    for (const c of def.postconditions ?? []) {
      if (c.objectTypeId && c.primaryKeyParam) {
        candidates.push({ objectTypeId: c.objectTypeId, pkParam: c.primaryKeyParam });
      }
    }
    for (const rule of [...(def.rules ?? []), ...(def.compensation ?? [])]) {
      if ('primaryKeyFromParam' in rule && 'objectTypeId' in rule) {
        candidates.push({
          objectTypeId: rule.objectTypeId,
          pkParam: rule.primaryKeyFromParam,
        });
      }
      if (rule.kind === 'create_link' || rule.kind === 'delete_link') {
        candidates.push({
          objectTypeId: rule.sourceObjectTypeId,
          pkParam: rule.sourcePrimaryKeyFromParam,
        });
        candidates.push({
          objectTypeId: rule.targetObjectTypeId,
          pkParam: rule.targetPrimaryKeyFromParam,
        });
      }
    }

    for (const c of candidates) {
      const pk = String(paramValue(params, c.pkParam) ?? '');
      if (!pk) continue;
      const obj = await asValue(objects.get(ontologyId, c.objectTypeId, pk));
      if (obj) map.set(`${c.objectTypeId}::${pk}`, obj);
    }
    return map;
  }

  // WHY: validateParams is delegated to the canonical module so type/enum/validator
  // logic does not scatter across the executor.
  function validateParams(
    def: ActionTypeDef,
    params: Record<string, unknown>,
  ): { field?: string; message: string }[] {
    return validateActionParameters(def, params);
  }

  function expectedVersionOf(
    expectedObjectVersions: Record<string, number> | undefined,
    objectTypeId: string,
    primaryKey: string,
  ): number | undefined {
    return expectedObjectVersions?.[`${objectTypeId}::${primaryKey}`];
  }

  async function applyRule(
    stores: ActionTransactionStores,
    rule: ActionRule,
    ontologyId: OntologyId,
    params: Record<string, unknown>,
    principal: string,
    created: ObjectRecord[],
    modified: ObjectRecord[],
    linkIds: string[],
    expectedObjectVersions?: Record<string, number>,
  ): Promise<void> {
    const { objects, links, events } = stores;
    if (rule.kind === 'create_object') {
      const pk = String(paramValue(params, rule.primaryKeyFromParam) ?? '');
      const properties: Record<string, unknown> = {};
      for (const [prop, paramName] of Object.entries(rule.propertiesFromParams ?? {})) {
        const v = paramValue(params, paramName);
        if (v !== undefined) properties[prop] = v;
      }
      const obj = await asValue(
        objects.create({
          ontologyId,
          objectTypeId: rule.objectTypeId,
          primaryKey: pk,
          properties,
          source: 'action',
        }),
      );
      created.push(obj);
      await events.append({
        kind: 'ObjectCreated',
        ontologyId,
        principal,
        objectId: obj.id,
        objectTypeId: obj.objectTypeId,
        primaryKey: obj.primaryKey,
      });
      return;
    }

    if (rule.kind === 'modify_object') {
      const pk = String(paramValue(params, rule.primaryKeyFromParam) ?? '');
      const properties: Record<string, unknown> = {};
      for (const [prop, paramName] of Object.entries(rule.setPropertiesFromParams)) {
        const v = paramValue(params, paramName);
        if (v !== undefined) properties[prop] = v;
      }
      const obj = await asValue(
        objects.update(ontologyId, rule.objectTypeId, pk, {
          properties,
          expectedVersion: expectedVersionOf(expectedObjectVersions, rule.objectTypeId, pk),
        }),
      );
      modified.push(obj);
      await events.append({
        kind: 'ObjectModified',
        ontologyId,
        principal,
        objectId: obj.id,
        objectTypeId: obj.objectTypeId,
        primaryKey: obj.primaryKey,
        payload: { properties },
      });
      return;
    }

    if (rule.kind === 'delete_object') {
      const pk = String(paramValue(params, rule.primaryKeyFromParam) ?? '');
      await asValue(
        objects.delete(ontologyId, rule.objectTypeId, pk, {
          expectedVersion: expectedVersionOf(expectedObjectVersions, rule.objectTypeId, pk),
        }),
      );
      await events.append({
        kind: 'ObjectDeleted',
        ontologyId,
        principal,
        objectTypeId: rule.objectTypeId,
        primaryKey: pk,
      });
      return;
    }

    if (rule.kind === 'create_link') {
      const link = await asValue(
        links.create({
          ontologyId,
          linkTypeId: rule.linkTypeId,
          sourceObjectTypeId: rule.sourceObjectTypeId,
          sourcePrimaryKey: String(paramValue(params, rule.sourcePrimaryKeyFromParam) ?? ''),
          targetObjectTypeId: rule.targetObjectTypeId,
          targetPrimaryKey: String(paramValue(params, rule.targetPrimaryKeyFromParam) ?? ''),
        }),
      );
      linkIds.push(link.id);
      await events.append({
        kind: 'LinkCreated',
        ontologyId,
        principal,
        linkId: link.id,
        linkTypeId: link.linkTypeId,
      });
      return;
    }

    if (rule.kind === 'delete_link') {
      const srcPk = String(paramValue(params, rule.sourcePrimaryKeyFromParam) ?? '');
      const tgtPk = String(paramValue(params, rule.targetPrimaryKeyFromParam) ?? '');
      const linkCasKey = `link:${rule.linkTypeId}/${rule.sourceObjectTypeId}/${srcPk}/${rule.targetObjectTypeId}/${tgtPk}`;
      const expectedLinkVersion = expectedObjectVersions?.[linkCasKey];
      await asValue(
        links.delete(
          ontologyId,
          rule.linkTypeId,
          rule.sourceObjectTypeId,
          srcPk,
          rule.targetObjectTypeId,
          tgtPk,
          expectedLinkVersion !== undefined ? { expectedVersion: expectedLinkVersion } : undefined,
        ),
      );
      await events.append({
        kind: 'LinkDeleted',
        ontologyId,
        principal,
        linkTypeId: rule.linkTypeId,
      });
      return;
    }

    if (rule.kind === 'generate_document') {
      const pk = String(paramValue(params, rule.primaryKeyFromParam) ?? '');
      const current = await asValue(objects.get(ontologyId, rule.objectTypeId, pk));
      if (!current) {
        throw new Error(`generate_document: object ${rule.objectTypeId}::${pk} not found`);
      }
      const template =
        rule.templateFromParam != null
          ? String(paramValue(params, rule.templateFromParam) ?? '')
          : (rule.template ?? '');
      const rendered = renderDocumentTemplate(
        template,
        templateContextFrom(current.properties, params),
      );
      const obj = await asValue(
        objects.update(ontologyId, rule.objectTypeId, pk, {
          properties: { [rule.outputProperty]: rendered },
          expectedVersion: expectedVersionOf(expectedObjectVersions, rule.objectTypeId, pk),
        }),
      );
      modified.push(obj);
      await events.append({
        kind: 'ObjectModified',
        ontologyId,
        principal,
        objectId: obj.id,
        objectTypeId: obj.objectTypeId,
        primaryKey: obj.primaryKey,
        payload: { properties: { [rule.outputProperty]: rendered } },
      });
    }
  }

  async function recordAudit(
    stores: ActionTransactionStores,
    def: ActionTypeDef,
    execution: ActionExecution,
    kind: Extract<OperationalEventKind, 'ActionApplied' | 'ActionDenied' | 'ActionFailed'>,
  ): Promise<string> {
    const reqs = def.auditRequirements ?? {};
    const payload: Record<string, unknown> = {
      kind,
      actionTypeId: def.id,
      actionApiName: apiNameOf(def),
      status: execution.status,
    };
    if (reqs.includeParameters !== false) payload.parameters = execution.parameters;
    if (reqs.includeResult !== false && execution.result) payload.result = execution.result;
    if (execution.error) payload.error = execution.error;
    const entry = await stores.audit.append(
      JSON.stringify(payload),
      {
        ontologyId: execution.ontologyId,
        executionId: execution.id,
        actionApiName: apiNameOf(def),
        kind,
      },
      execution.principal,
    );
    await stores.events.append({
      kind,
      ontologyId: execution.ontologyId,
      principal: execution.principal,
      actionTypeId: def.id,
      actionExecutionId: execution.id,
      payload,
    });
    return entry.id;
  }

  async function runRules(
    stores: ActionTransactionStores,
    def: ActionTypeDef,
    ontologyId: OntologyId,
    params: Record<string, unknown>,
    principal: string,
    expectedObjectVersions?: Record<string, number>,
  ): Promise<Record<string, unknown>> {
    const touched: Record<string, unknown> = { modified: [], created: [], links: [] };
    const modified: ObjectRecord[] = [];
    const created: ObjectRecord[] = [];
    const linkIds: string[] = [];

    for (const rule of def.rules ?? []) {
      await applyRule(
        stores,
        rule,
        ontologyId,
        params,
        principal,
        created,
        modified,
        linkIds,
        expectedObjectVersions,
      );
    }

    touched.modified = modified.map((o) => ({
      objectTypeId: o.objectTypeId,
      primaryKey: o.primaryKey,
      version: o.version,
    }));
    touched.created = created.map((o) => ({
      objectTypeId: o.objectTypeId,
      primaryKey: o.primaryKey,
    }));
    touched.links = linkIds;
    return touched;
  }

  async function runSideEffects(
    stores: ActionTransactionStores,
    effects: ActionSideEffect[] | undefined,
    params: Record<string, unknown>,
    ontologyId: OntologyId,
    principal: string,
    executionId: string,
  ): Promise<void> {
    for (const effect of effects ?? []) {
      if (effect.kind === 'connector_writeback') {
        const payload = {
          connectorId: effect.connectorId,
          operation: effect.operation,
          params,
        };
        await stores.events.append({
          kind: 'ExternalWritebackRequested',
          ontologyId,
          principal,
          actionExecutionId: executionId,
          payload,
        });
        if (stores.outbox) {
          await stores.outbox.insert({
            topic: 'action.side_effect.writeback',
            key: `${ontologyId}+${executionId}`,
            payload: { kind: 'connector_writeback', ...payload },
            principal,
            tenantId: 'default',
            traceId: executionId,
          });
        }
      }
    }
  }

  async function validateWith(
    stores: ActionTransactionStores,
    req: ActionValidateRequest,
    pinned?: ResolvedActionDefinition,
  ): Promise<ActionValidateResult> {
    const resolved =
      pinned ?? (await resolveByApiName(req.ontologyId, req.actionApiName));
    if (!resolved) {
      return {
        valid: false,
        errors: [{ message: `unknown action: ${req.actionApiName}` }],
        submissionCriteriaMet: false,
      };
    }
    const def = resolved.def;
    const errors = validateParams(def, req.parameters);
    const refs = await loadReferencedObjects(
      stores.objects,
      def,
      req.parameters,
      req.ontologyId,
    );
    let criteriaMet = true;
    for (const c of def.submissionCriteria ?? []) {
      if (!evaluateCriterion(c, req.parameters, refs)) {
        criteriaMet = false;
        errors.push({ message: `submission criterion failed: ${c.kind}` });
      }
    }
    return {
      valid: errors.length === 0 && criteriaMet,
      errors,
      submissionCriteriaMet: criteriaMet,
    };
  }

  async function applyWith(
    stores: ActionTransactionStores,
    req: ActionApplyRequest,
    onPersisted?: (execution: ActionExecution) => void,
  ): Promise<ActionApplyResult> {
    const resolved = await resolveByApiName(
      req.ontologyId,
      req.actionApiName,
      req.ontologyVersionId,
    );
    if (!resolved) {
      return {
        executionId: nextId('aex'),
        status: 'FAILED',
        actionTypeId: req.actionApiName,
        error: `unknown action: ${req.actionApiName}`,
      };
    }
    const def = resolved.def;

    // WHY: mutating Actions must be replay-safe before any claim.
    if (isMutatingAction(def) && !req.idempotencyKey) {
      return {
        executionId: nextId('aex'),
        status: 'FAILED',
        actionTypeId: def.id,
        error: 'mutating action requires idempotencyKey',
      };
    }
    if (needsExpectedVersions(def) && !req.expectedObjectVersions) {
      return {
        executionId: nextId('aex'),
        status: 'FAILED',
        actionTypeId: def.id,
        error: 'mutating action requires expectedObjectVersions',
      };
    }

    const executionId = nextId('aex');
    const startedAt = clock();

    // WHY: compute the canonical hash before claim so the store can detect
    // IDEMPOTENCY_CONFLICT when the same key is reused with a different payload.
    let requestHash: string | undefined;
    let hashVersion: number | undefined;
    if (req.idempotencyKey) {
      const identity = buildActionRequestIdentity(
        {
          ontologyId: req.ontologyId,
          principal: req.principal,
          actionApiName: apiNameOf(def),
          idempotencyKey: req.idempotencyKey,
        },
        {
          ontologyId: req.ontologyId,
          ontologyVersionId: resolved.ontologyVersionId,
          actionTypeId: def.id,
          actionTypeHash: resolved.hash,
          principal: req.principal,
          parameters: req.parameters,
          expectedObjectVersions: req.expectedObjectVersions,
        },
      );
      requestHash = identity.requestHash;
      hashVersion = identity.hashVersion;
    }

    let execution: ActionExecution = {
      id: executionId,
      ontologyId: req.ontologyId,
      ontologyVersionId: resolved.ontologyVersionId,
      actionTypeId: def.id,
      actionApiName: apiNameOf(def),
      actionTypeHash: resolved.hash,
      parameters: { ...req.parameters },
      principal: req.principal,
      status: 'PENDING',
      idempotencyKey: req.idempotencyKey,
      expectedObjectVersions: req.expectedObjectVersions
        ? { ...req.expectedObjectVersions }
        : undefined,
      policyGeneration: policyGeneration(),
      startedAt,
      requestHash,
      hashVersion,
    };

    if (req.idempotencyKey) {
      const claimed = await stores.executions.claim(execution);
      if (!claimed.claimed) {
        return resultOf(claimed.execution);
      }
      execution = claimed.execution;
    } else {
      await stores.executions.save(execution);
    }
    onPersisted?.(execution);

    const authz = authorize({
      principal: req.principal,
      resource: ResourceIds.action(req.ontologyId, apiNameOf(def)),
      operation: 'modify',
    });
    if (!allowsMutation(authz)) {
      transitionExecution(execution, 'DENIED');
      execution.finishedAt = clock();
      execution.error = authz.reason;
      execution.auditEntryId = await recordAudit(stores, def, execution, 'ActionDenied');
      await stores.executions.save(execution);
      return resultOf(execution);
    }
    transitionExecution(execution, 'AUTHORIZED');
    await stores.executions.save(execution);

    const validation = await validateWith(
      stores,
      {
        ontologyId: req.ontologyId,
        actionApiName: req.actionApiName,
        parameters: req.parameters,
        principal: req.principal,
      },
      resolved,
    );
    if (!validation.valid) {
      transitionExecution(execution, 'FAILED');
      execution.finishedAt = clock();
      execution.error = validation.errors.map((e) => e.message).join('; ');
      execution.auditEntryId = await recordAudit(stores, def, execution, 'ActionFailed');
      await stores.executions.save(execution);
      return resultOf(execution);
    }
    transitionExecution(execution, 'VALIDATED');
    await stores.executions.save(execution);

    // WHY: create-then-modify workflows pass one version map to every step.
    // Create must not fail-closed on a key that does not exist yet.
    if (needsExpectedVersions(def) && req.expectedObjectVersions) {
      const conflict = await compareExpectedVersions(
        stores,
        req.ontologyId,
        req.expectedObjectVersions,
        def,
        req.parameters,
      );
      if (conflict) {
        transitionExecution(execution, 'FAILED');
        execution.finishedAt = clock();
        execution.error = conflict;
        execution.auditEntryId = await recordAudit(stores, def, execution, 'ActionFailed');
        await stores.executions.save(execution);
        return resultOf(execution);
      }
    }

    const needsApproval = def.requiresApproval === true || def.approvals?.required === true;
    if (needsApproval) {
      transitionExecution(execution, 'AWAITING_APPROVAL');
      execution.approval = { required: true, requestedAt: clock() };
      await stores.executions.save(execution);
      await stores.events.append({
        kind: 'ApprovalRequested',
        ontologyId: req.ontologyId,
        principal: req.principal,
        actionTypeId: def.id,
        actionExecutionId: execution.id,
      });
      if (stores.outbox) {
        await stores.outbox.insert({
          topic: 'action.approval.requested',
          key: `${req.ontologyId}+${execution.id}`,
          payload: { executionId: execution.id, actionApiName: apiNameOf(def) },
          principal: req.principal,
          tenantId: 'default',
          traceId: execution.id,
        });
      }
      return resultOf(execution);
    }

    return runWriteback(stores, execution, def);
  }

  /**
   * Collect the canonical CAS keys that MUST appear in expectedObjectVersions
   * for every modify/delete/generate_document/delete_link rule in def.
   * Object keys use `<objectTypeId>::<primaryKey>`.
   * Link keys use `link:<linkTypeId>/<srcType>/<srcPk>/<tgtType>/<tgtPk>`.
   * WHY: {} is not CAS — an absent key means no version was pinned, not that
   * any version is acceptable (fail-closed).
   */
  function requiredCasKeys(
    def: ActionTypeDef,
    params: Record<string, unknown>,
  ): string[] {
    const keys: string[] = [];
    for (const rule of def.rules ?? []) {
      if (
        rule.kind === 'modify_object' ||
        rule.kind === 'delete_object' ||
        rule.kind === 'generate_document'
      ) {
        const pk = String(params[rule.primaryKeyFromParam] ?? '');
        if (pk) keys.push(`${rule.objectTypeId}::${pk}`);
      } else if (rule.kind === 'delete_link') {
        const srcPk = String(params[rule.sourcePrimaryKeyFromParam] ?? '');
        const tgtPk = String(params[rule.targetPrimaryKeyFromParam] ?? '');
        if (srcPk && tgtPk) {
          keys.push(
            `link:${rule.linkTypeId}/${rule.sourceObjectTypeId}/${srcPk}/${rule.targetObjectTypeId}/${tgtPk}`,
          );
        }
      }
    }
    return keys;
  }

  async function compareExpectedVersions(
    stores: ActionTransactionStores,
    ontologyId: OntologyId,
    expectedObjectVersions: Record<string, number>,
    def: ActionTypeDef,
    params: Record<string, unknown>,
  ): Promise<string | undefined> {
    // WHY: every modify/delete target must have an explicit expected version;
    // an absent key is a missing CAS pin, not a "use current" fallback.
    const required = requiredCasKeys(def, params);
    for (const key of required) {
      if (!(key in expectedObjectVersions)) {
        return `version conflict on ${key}: missing expected version`;
      }
    }
    for (const [key, expected] of Object.entries(expectedObjectVersions)) {
      if (key.startsWith('link:')) {
        // link:<linkTypeId>/<srcType>/<srcPk>/<tgtType>/<tgtPk>
        const rest = key.slice('link:'.length);
        const [linkTypeId, srcType, srcPk, tgtType, tgtPk] = rest.split('/');
        if (!linkTypeId || !srcType || !srcPk || !tgtType || !tgtPk) continue;
        const links = await asValue(
          stores.links.listFrom(ontologyId, srcType, srcPk, linkTypeId),
        );
        const link = links.find(
          (l) => l.targetObjectTypeId === tgtType && l.targetPrimaryKey === tgtPk,
        );
        if (!link || link.version !== Number(expected)) {
          return `version conflict on ${key}`;
        }
      } else {
        const [objectTypeId, primaryKey] = key.split('::');
        if (!objectTypeId || !primaryKey) continue;
        const obj = await asValue(stores.objects.get(ontologyId, objectTypeId, primaryKey));
        if (!obj || obj.version !== Number(expected)) {
          return `version conflict on ${key}`;
        }
      }
    }
    return undefined;
  }

  async function runWriteback(
    stores: ActionTransactionStores,
    execution: ActionExecution,
    def: ActionTypeDef,
  ): Promise<ActionApplyResult> {
    if (execution.status !== 'RUNNING') {
      transitionExecution(execution, 'RUNNING');
      await stores.executions.save(execution);
    }

    const result = await runRules(
      stores,
      def,
      execution.ontologyId,
      execution.parameters,
      execution.principal,
      execution.expectedObjectVersions,
    );

    const refsAfter = await loadReferencedObjects(
      stores.objects,
      def,
      execution.parameters,
      execution.ontologyId,
    );
    for (const c of def.postconditions ?? []) {
      if (!evaluateCriterion(c, execution.parameters, refsAfter)) {
        if (def.compensation?.length) {
          await runRules(
            stores,
            { ...def, rules: def.compensation },
            execution.ontologyId,
            execution.parameters,
            execution.principal,
          );
        }
        transitionExecution(execution, 'FAILED');
        execution.finishedAt = clock();
        execution.error = `postcondition failed: ${c.kind}`;
        execution.result = result;
        execution.auditEntryId = await recordAudit(stores, def, execution, 'ActionFailed');
        await stores.executions.save(execution);
        return resultOf(execution);
      }
    }

    await runSideEffects(
      stores,
      def.sideEffects,
      execution.parameters,
      execution.ontologyId,
      execution.principal,
      execution.id,
    );

    transitionExecution(execution, 'SUCCEEDED');
    execution.finishedAt = clock();
    execution.result = result;
    execution.auditEntryId = await recordAudit(stores, def, execution, 'ActionApplied');
    await stores.executions.save(execution);
    return resultOf(execution);
  }

  return {
    async validate(req: ActionValidateRequest): Promise<ActionValidateResult> {
      return validateWith(defaultStores, req);
    },

    async parameterTree(req: ActionValidateRequest): Promise<ActionParameterTree> {
      const resolved = await resolveByApiName(req.ontologyId, req.actionApiName);
      if (!resolved) {
        throw new Error(`unknown action: ${req.actionApiName}`);
      }
      const refs = await loadReferencedObjects(
        defaultStores.objects,
        resolved.def,
        req.parameters,
        req.ontologyId,
      );
      return buildParameterTree(resolved.def, req.parameters, refs);
    },

    async apply(req: ActionApplyRequest): Promise<ActionApplyResult> {
      let persisted: ActionExecution | undefined;
      const run = (stores: ActionTransactionStores) =>
        applyWith(stores, req, (e) => {
          persisted = e;
        });
      try {
        if (opts.unitOfWork) {
          return await opts.unitOfWork.run(run);
        }
        return await run(defaultStores);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // WHY: IDEMPOTENCY_CONFLICT means same key + different payload: do not write
        // any business effects. Return FAILED without a persisted execution row so
        // the caller receives the conflict reason and no side effects are committed.
        if ((err as { code?: string }).code === 'IDEMPOTENCY_CONFLICT') {
          return {
            executionId: nextId('aex'),
            status: 'FAILED',
            actionTypeId: req.actionApiName,
            error: msg,
          };
        }
        if (persisted) {
          if (!isTerminalStatus(persisted.status)) {
            transitionExecution(persisted, 'FAILED');
          }
          persisted.finishedAt = clock();
          persisted.error = msg;
          await defaultStores.executions.save(persisted);
          return resultOf(persisted);
        }
        return {
          executionId: nextId('aex'),
          status: 'FAILED',
          actionTypeId: req.actionApiName,
          error: msg,
        };
      }
    },

    async getExecution(id) {
      return defaultStores.executions.get(id);
    },

    async approve(id, principal) {
      return decideApproval(id, principal, 'approved');
    },

    async reject(id, principal) {
      return decideApproval(id, principal, 'rejected');
    },
  };

  async function decideApproval(
    id: string,
    principal: string,
    decision: 'approved' | 'rejected',
  ): Promise<ActionApplyResult> {
    const current = await defaultStores.executions.get(id);
    if (!current) {
      return {
        executionId: id,
        status: 'FAILED',
        actionTypeId: '',
        error: `unknown execution: ${id}`,
      };
    }
    if (isTerminalStatus(current.status)) {
      return resultOf(current);
    }
    if (current.status !== 'AWAITING_APPROVAL') {
      throw new Error(`illegal transition: ${current.status} → ${decision}`);
    }

    const preview = current.ontologyVersionId && current.actionTypeId
      ? await resolver.resolve(current.ontologyId, current.ontologyVersionId, current.actionTypeId)
      : null;
    if (principal === current.principal) {
      throw new Error('self-approval is blocked when approverPolicy is set');
    }
    const approverPolicy = preview?.def.approvals?.approverPolicy;
    if (!approverPolicy) {
      throw new Error('approverPolicy is required to approve or reject');
    }
    const approverAuthz = authorize({
      principal,
      resource: ResourceIds.approver(current.ontologyId, approverPolicy),
      operation: 'modify',
    });
    if (!allowsMutation(approverAuthz)) {
      throw new Error(approverAuthz.reason);
    }

    const run = (stores: ActionTransactionStores) =>
      resumeApproval(stores, current, principal, decision);
    try {
      if (opts.unitOfWork) return await opts.unitOfWork.run(run);
      return await run(defaultStores);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/self-approval|illegal transition/.test(msg)) throw err;
      if (!isTerminalStatus(current.status)) {
        try {
          transitionExecution(current, 'FAILED');
        } catch {
          current.status = 'FAILED';
        }
      }
      current.finishedAt = clock();
      current.error = msg;
      await defaultStores.executions.save(current);
      return resultOf(current);
    }
  }

  async function resumeApproval(
    stores: ActionTransactionStores,
    seed: ActionExecution,
    principal: string,
    decision: 'approved' | 'rejected',
  ): Promise<ActionApplyResult> {
    const current = (await stores.executions.get(seed.id)) ?? seed;
    if (isTerminalStatus(current.status)) return resultOf(current);
    if (current.status !== 'AWAITING_APPROVAL') {
      return resultOf(current);
    }

    if (
      !current.ontologyVersionId ||
      !current.actionTypeHash ||
      !current.actionTypeId
    ) {
      assertActionTransition(current.status, 'FAILED');
      const swapped = await casOrSave(stores, current, 'FAILED', {
        finishedAt: clock(),
        error: 'resume requires pinned ontologyVersionId and actionTypeHash',
      });
      const failed = swapped ?? current;
      failed.auditEntryId = await recordAudit(
        stores,
        { id: current.actionTypeId, displayName: current.actionApiName, inputObjectTypeIds: [] },
        failed,
        'ActionFailed',
      );
      await stores.executions.save(failed);
      return resultOf(failed);
    }

    let resolved: ResolvedActionDefinition;
    try {
      resolved = await resolver.resolve(
        current.ontologyId,
        current.ontologyVersionId,
        current.actionTypeId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      transitionExecution(current, 'FAILED');
      current.finishedAt = clock();
      current.error = msg;
      current.auditEntryId = await recordAudit(
        stores,
        { id: current.actionTypeId, displayName: current.actionApiName, inputObjectTypeIds: [] },
        current,
        'ActionFailed',
      );
      await stores.executions.save(current);
      return resultOf(current);
    }

    const def = resolved.def;
    const approverPolicy = def.approvals?.approverPolicy;
    if (!approverPolicy) {
      throw new Error('approverPolicy is required to approve or reject');
    }
    if (principal === current.principal) {
      throw new Error('self-approval is blocked when approverPolicy is set');
    }
    const approverAuthz = authorize({
      principal,
      resource: ResourceIds.approver(current.ontologyId, approverPolicy),
      operation: 'modify',
    });
    if (!allowsMutation(approverAuthz)) {
      throw new Error(approverAuthz.reason);
    }

    if (decision === 'rejected') {
      assertActionTransition('AWAITING_APPROVAL', 'REJECTED');
      const swapped = await casOrSave(stores, current, 'REJECTED', {
        finishedAt: clock(),
        error: `rejected by ${principal}`,
        approval: {
          required: true,
          requestedAt: current.approval?.requestedAt,
          decidedAt: clock(),
          decidedBy: principal,
          decision: 'rejected',
        },
      });
      if (!swapped) {
        const now = await stores.executions.get(current.id);
        return resultOf(now ?? current);
      }
      await stores.events.append({
        kind: 'ApprovalDecided',
        ontologyId: current.ontologyId,
        principal,
        actionExecutionId: current.id,
        payload: { decision: 'rejected' },
      });
      return resultOf(swapped);
    }

    const authz = authorize({
      principal: current.principal,
      resource: ResourceIds.action(current.ontologyId, apiNameOf(def)),
      operation: 'modify',
    });
    if (!allowsMutation(authz)) {
      assertActionTransition('AWAITING_APPROVAL', 'DENIED');
      const swapped = await casOrSave(stores, current, 'DENIED', {
        finishedAt: clock(),
        error: authz.reason,
      });
      const denied = swapped ?? { ...current, status: 'DENIED' as const, error: authz.reason };
      denied.auditEntryId = await recordAudit(stores, def, denied, 'ActionDenied');
      await stores.executions.save(denied);
      return resultOf(denied);
    }

    if (resolved.hash !== current.actionTypeHash) {
      assertActionTransition('AWAITING_APPROVAL', 'FAILED');
      const swapped = await casOrSave(stores, current, 'FAILED', {
        finishedAt: clock(),
        error: 'pinned ActionType hash diverged from ontology version',
      });
      const failed = swapped ?? current;
      failed.auditEntryId = await recordAudit(stores, def, failed, 'ActionFailed');
      await stores.executions.save(failed);
      return resultOf(failed);
    }

    const validation = await validateWith(
      stores,
      {
        ontologyId: current.ontologyId,
        actionApiName: current.actionApiName,
        parameters: current.parameters,
        principal: current.principal,
      },
      resolved,
    );
    if (!validation.valid) {
      assertActionTransition('AWAITING_APPROVAL', 'FAILED');
      const swapped = await casOrSave(stores, current, 'FAILED', {
        finishedAt: clock(),
        error: validation.errors.map((e) => e.message).join('; '),
      });
      const failed = swapped ?? current;
      failed.auditEntryId = await recordAudit(stores, def, failed, 'ActionFailed');
      await stores.executions.save(failed);
      return resultOf(failed);
    }

    if (needsExpectedVersions(def) && current.expectedObjectVersions) {
      const conflict = await compareExpectedVersions(
        stores,
        current.ontologyId,
        current.expectedObjectVersions,
        def,
        current.parameters,
      );
      if (conflict) {
        assertActionTransition('AWAITING_APPROVAL', 'FAILED');
        const swapped = await casOrSave(stores, current, 'FAILED', {
          finishedAt: clock(),
          error: conflict,
        });
        const failed = swapped ?? current;
        failed.auditEntryId = await recordAudit(stores, def, failed, 'ActionFailed');
        await stores.executions.save(failed);
        return resultOf(failed);
      }
    }

    assertActionTransition('AWAITING_APPROVAL', 'RUNNING');
    const running = await casOrSave(stores, current, 'RUNNING', {
      approval: {
        required: true,
        requestedAt: current.approval?.requestedAt,
        decidedAt: clock(),
        decidedBy: principal,
        decision: 'approved',
      },
    });
    if (!running) {
      const now = await stores.executions.get(current.id);
      return resultOf(now ?? current);
    }

    await stores.events.append({
      kind: 'ApprovalDecided',
      ontologyId: current.ontologyId,
      principal,
      actionExecutionId: current.id,
      payload: { decision: 'approved' },
    });
    return runWriteback(stores, running, def);
  }

  async function casOrSave(
    stores: ActionTransactionStores,
    current: ActionExecution,
    to: ActionExecution['status'],
    patch: Partial<ActionExecution>,
  ): Promise<ActionExecution | undefined> {
    if (stores.executions.casStatus) {
      return stores.executions.casStatus(current.id, current.status, to, patch);
    }
    const next = { ...current, ...patch, status: to };
    await stores.executions.save(next);
    return next;
  }
}

export { createMemoryOperationalEventStore };
export { createMemoryActionExecutionStore } from './execution-store.js';
