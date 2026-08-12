/**
 * action-engine — src/core/executor.ts
 * Generic ActionExecutor.
 */

import type {
  ActionApplyRequest,
  ActionApplyResult,
  ActionExecution,
  ActionExecutor,
  ActionRule,
  ActionSideEffect,
  ActionSubmissionCriterion,
  ActionTypeDef,
  ActionValidateRequest,
  ActionValidateResult,
  AuthorizeFn,
  ObjectRecord,
  OntologyId,
} from 'contracts';

import {
  createDeterministicClock,
  createIdGenerator,
} from 'object-platform';
import { createAuditLog } from 'policy-engine';

import { createMemoryOperationalEventStore } from './events.js';
import type { CreateActionExecutorOptions } from './types.js';

const allowAll: AuthorizeFn = (req) => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: `default-allow ${req.operation}`,
});

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

export function createActionExecutor(
  opts: CreateActionExecutorOptions,
): ActionExecutor {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const authorize = opts.authorize ?? allowAll;
  const objects = opts.objects;
  const links = opts.links;
  const audit = opts.audit ?? createAuditLog({ clock, nextId });
  const events =
    opts.events ?? createMemoryOperationalEventStore({ clock, nextId });

  const actionTypes = new Map<string, ActionTypeDef>();
  const executions = new Map<string, ActionExecution>();
  const idempotency = new Map<string, string>();

  if (opts.actionTypes) {
    for (const [ontologyId, defs] of Object.entries(opts.actionTypes)) {
      for (const def of defs) {
        actionTypes.set(`${ontologyId}::${apiNameOf(def)}`, def);
      }
    }
  }

  function getDef(ontologyId: OntologyId, apiName: string): ActionTypeDef | undefined {
    return actionTypes.get(`${ontologyId}::${apiName}`);
  }

  async function loadReferencedObjects(
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
    for (const rule of def.rules ?? []) {
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

  function validateParams(
    def: ActionTypeDef,
    params: Record<string, unknown>,
  ): { field?: string; message: string }[] {
    const errors: { field?: string; message: string }[] = [];
    for (const [name, p] of Object.entries(def.parameters ?? {})) {
      const v = params[name];
      if (p.required !== false && (v === undefined || v === null || v === '')) {
        errors.push({ field: name, message: `parameter "${name}" is required` });
      }
    }
    return errors;
  }

  async function runRules(
    def: ActionTypeDef,
    ontologyId: OntologyId,
    params: Record<string, unknown>,
    principal: string,
  ): Promise<Record<string, unknown>> {
    const touched: Record<string, unknown> = { modified: [], created: [], links: [] };
    const modified: ObjectRecord[] = [];
    const created: ObjectRecord[] = [];
    const linkIds: string[] = [];

    for (const rule of def.rules ?? []) {
      await applyRule(rule, ontologyId, params, principal, created, modified, linkIds);
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

  async function applyRule(
    rule: ActionRule,
    ontologyId: OntologyId,
    params: Record<string, unknown>,
    principal: string,
    created: ObjectRecord[],
    modified: ObjectRecord[],
    linkIds: string[],
  ): Promise<void> {
    if (rule.kind === 'create_object') {
      const pk = String(paramValue(params, rule.primaryKeyFromParam) ?? '');
      const properties: Record<string, unknown> = {};
      for (const [prop, paramName] of Object.entries(rule.propertiesFromParams ?? {})) {
        properties[prop] = paramValue(params, paramName);
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
      events.append({
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
        properties[prop] = paramValue(params, paramName);
      }
      const obj = await asValue(
        objects.update(ontologyId, rule.objectTypeId, pk, { properties }),
      );
      modified.push(obj);
      events.append({
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
      await asValue(objects.delete(ontologyId, rule.objectTypeId, pk));
      events.append({
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
      events.append({
        kind: 'LinkCreated',
        ontologyId,
        principal,
        linkId: link.id,
        linkTypeId: link.linkTypeId,
      });
      return;
    }

    if (rule.kind === 'delete_link') {
      await asValue(
        links.delete(
          ontologyId,
          rule.linkTypeId,
          rule.sourceObjectTypeId,
          String(paramValue(params, rule.sourcePrimaryKeyFromParam) ?? ''),
          rule.targetObjectTypeId,
          String(paramValue(params, rule.targetPrimaryKeyFromParam) ?? ''),
        ),
      );
      events.append({
        kind: 'LinkDeleted',
        ontologyId,
        principal,
        linkTypeId: rule.linkTypeId,
      });
    }
  }

  function runSideEffects(
    effects: ActionSideEffect[] | undefined,
    params: Record<string, unknown>,
    ontologyId: OntologyId,
    principal: string,
    executionId: string,
  ): void {
    for (const effect of effects ?? []) {
      if (effect.kind === 'connector_writeback') {
        events.append({
          kind: 'ExternalWritebackRequested',
          ontologyId,
          principal,
          actionExecutionId: executionId,
          payload: {
            connectorId: effect.connectorId,
            operation: effect.operation,
            params,
          },
        });
      }
      // webhook / notification: recorded as payload only in this milestone
    }
  }

  return {
    getActionType(ontologyId, apiName) {
      return getDef(ontologyId, apiName);
    },

    registerActionType(ontologyId, def) {
      actionTypes.set(`${ontologyId}::${apiNameOf(def)}`, def);
    },

    async validate(req: ActionValidateRequest): Promise<ActionValidateResult> {
      const def = getDef(req.ontologyId, req.actionApiName);
      if (!def) {
        return {
          valid: false,
          errors: [{ message: `unknown action: ${req.actionApiName}` }],
          submissionCriteriaMet: false,
        };
      }
      const errors = validateParams(def, req.parameters);
      const refs = await loadReferencedObjects(def, req.parameters, req.ontologyId);
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
    },

    async apply(req: ActionApplyRequest): Promise<ActionApplyResult> {
      const def = getDef(req.ontologyId, req.actionApiName);
      if (!def) {
        return {
          executionId: nextId('aex'),
          status: 'FAILED',
          actionTypeId: req.actionApiName,
          error: `unknown action: ${req.actionApiName}`,
        };
      }

      if (req.idempotencyKey) {
        const ik = `${req.ontologyId}::${req.actionApiName}::${req.idempotencyKey}`;
        const existingId = idempotency.get(ik);
        if (existingId) {
          const prev = executions.get(existingId)!;
          return {
            executionId: prev.id,
            status: prev.status,
            actionTypeId: prev.actionTypeId,
            result: prev.result,
            error: prev.error,
            auditEntryId: prev.auditEntryId,
          };
        }
      }

      const executionId = nextId('aex');
      const startedAt = clock();
      const execution: ActionExecution = {
        id: executionId,
        ontologyId: req.ontologyId,
        actionTypeId: def.id,
        actionApiName: apiNameOf(def),
        parameters: { ...req.parameters },
        principal: req.principal,
        status: 'PENDING',
        idempotencyKey: req.idempotencyKey,
        startedAt,
      };
      executions.set(executionId, execution);

      // authorize
      const authz = authorize({
        principal: req.principal,
        resource: `action:${apiNameOf(def)}`,
        operation: 'modify',
      });
      if (authz.decision === 'deny') {
        execution.status = 'DENIED';
        execution.finishedAt = clock();
        execution.error = authz.reason;
        return {
          executionId,
          status: 'DENIED',
          actionTypeId: def.id,
          error: authz.reason,
        };
      }
      execution.status = 'AUTHORIZED';

      // validate + criteria
      const validation = await this.validate({
        ontologyId: req.ontologyId,
        actionApiName: req.actionApiName,
        parameters: req.parameters,
        principal: req.principal,
      });
      if (!validation.valid) {
        execution.status = 'FAILED';
        execution.finishedAt = clock();
        execution.error = validation.errors.map((e) => e.message).join('; ');
        return {
          executionId,
          status: 'FAILED',
          actionTypeId: def.id,
          error: execution.error,
        };
      }
      execution.status = 'VALIDATED';

      // optimistic concurrency
      if (req.expectedObjectVersions) {
        for (const [key, expected] of Object.entries(req.expectedObjectVersions)) {
          const [objectTypeId, primaryKey] = key.split('::');
          if (!objectTypeId || !primaryKey) continue;
          const obj = await asValue(
            objects.get(req.ontologyId, objectTypeId, primaryKey),
          );
          if (!obj || obj.version !== expected) {
            execution.status = 'FAILED';
            execution.finishedAt = clock();
            execution.error = `version conflict on ${key}`;
            return {
              executionId,
              status: 'FAILED',
              actionTypeId: def.id,
              error: execution.error,
            };
          }
        }
      }

      execution.status = 'RUNNING';
      try {
        const result = await runRules(def, req.ontologyId, req.parameters, req.principal);
        runSideEffects(def.sideEffects, req.parameters, req.ontologyId, req.principal, executionId);

        const auditEntry = audit.append(
          JSON.stringify({
            kind: 'ActionApplied',
            actionTypeId: def.id,
            actionApiName: apiNameOf(def),
            parameters: req.parameters,
            result,
          }),
          {
            ontologyId: req.ontologyId,
            executionId,
            actionApiName: apiNameOf(def),
          },
          req.principal,
        );

        events.append({
          kind: 'ActionApplied',
          ontologyId: req.ontologyId,
          principal: req.principal,
          actionTypeId: def.id,
          actionExecutionId: executionId,
          payload: result,
        });

        execution.status = 'SUCCEEDED';
        execution.finishedAt = clock();
        execution.result = result;
        execution.auditEntryId = auditEntry.id;

        if (req.idempotencyKey) {
          idempotency.set(
            `${req.ontologyId}::${req.actionApiName}::${req.idempotencyKey}`,
            executionId,
          );
        }

        return {
          executionId,
          status: 'SUCCEEDED',
          actionTypeId: def.id,
          result,
          auditEntryId: auditEntry.id,
        };
      } catch (err) {
        execution.status = 'FAILED';
        execution.finishedAt = clock();
        execution.error = err instanceof Error ? err.message : String(err);
        return {
          executionId,
          status: 'FAILED',
          actionTypeId: def.id,
          error: execution.error,
        };
      }
    },

    getExecution(id) {
      return executions.get(id);
    },
  };
}

/** Expose event store helper for tests / API wiring. */
export { createMemoryOperationalEventStore };
