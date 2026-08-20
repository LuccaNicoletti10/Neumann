#!/usr/bin/env node
/**
 * action-engine — src/cli.ts
 * Passo 24: authorize → validate → tx → write-back → audit
 * Domain-neutral: Customer / SalesOrder / Product + approve-sales-order
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ActionTypeDef } from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';
import { sourceFieldsToProperties } from 'connector-sdk';
import { createAuditLog } from 'policy-engine';
import { createOntologyRegistry } from 'ontology-registry';

import { createActionExecutor, createMemoryOperationalEventStore } from './core/executor.js';
import { renderDocumentTemplate } from './core/document-template.js';
import { createMemoryOutboxRepository } from './core/memory-outbox.js';
import { applyDefVariableBindings } from './core/parameter-tree.js';
import { createActionWorkflowRunner } from './core/workflow.js';
import {
  demoMappings,
  demoSourceConnector,
  drainWriteBackToConnector,
} from './core/writeback-cycle.js';

const USAGE = `action-engine (act) — PASSO 24/25
  Pipeline: authorize → validate → tx → write-back → audit
  LLM/UI nunca escrevem objetos.

Uso:
  act demo
  act writeback
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const APPROVE: ActionTypeDef = {
  id: 'act.approve-sales-order',
  apiName: 'approve-sales-order',
  displayName: 'Approve Sales Order',
  inputObjectTypeIds: ['ot.sales-order'],
  parameters: {
    orderId: { baseType: 'object_reference', objectTypeId: 'ot.sales-order', required: true },
    status: { baseType: 'string', required: true, variableName: 'order_status' },
  },
  submissionCriteria: [
    {
      kind: 'property_equals',
      objectTypeId: 'ot.sales-order',
      primaryKeyParam: 'orderId',
      propertyTypeId: 'status',
      equals: 'pending',
    },
  ],
  rules: [
    {
      kind: 'modify_object',
      objectTypeId: 'ot.sales-order',
      primaryKeyFromParam: 'orderId',
      setPropertiesFromParams: { status: 'status' },
    },
  ],
  postconditions: [
    {
      kind: 'property_equals',
      objectTypeId: 'ot.sales-order',
      primaryKeyParam: 'orderId',
      propertyTypeId: 'status',
      equals: 'approved',
    },
  ],
  sideEffects: [
    { kind: 'connector_writeback', connectorId: 'erp-demo', operation: 'update_order_status' },
  ],
  auditRequirements: { includeParameters: true, includeResult: true },
};

const CREATE_ORDER: ActionTypeDef = {
  id: 'act.create-sales-order',
  apiName: 'create-sales-order',
  displayName: 'Create Sales Order',
  inputObjectTypeIds: ['ot.sales-order'],
  parameters: {
    orderId: { baseType: 'string', required: true },
    amount: { baseType: 'number', required: true },
    status: { baseType: 'string', required: true },
  },
  rules: [
    {
      kind: 'create_object',
      objectTypeId: 'ot.sales-order',
      primaryKeyFromParam: 'orderId',
      propertiesFromParams: { amount: 'amount', status: 'status' },
    },
  ],
};

const REPORT: ActionTypeDef = {
  id: 'act.order-report',
  apiName: 'order-report',
  displayName: 'Order report',
  inputObjectTypeIds: ['ot.sales-order'],
  parameters: {
    orderId: { baseType: 'object_reference', objectTypeId: 'ot.sales-order', required: true },
  },
  rules: [
    {
      kind: 'generate_document',
      objectTypeId: 'ot.sales-order',
      primaryKeyFromParam: 'orderId',
      template: 'Order {{orderId}} status={{status}} amount={{amount}}',
      outputProperty: 'report',
    },
  ],
};

export async function runDemo(log: (message: string) => void = console.log): Promise<number> {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const objects = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({ clock, nextId });
  const audit = createAuditLog({ clock, nextId });
  const ontology = createOntologyRegistry({ clock, nextId });
  const onto = await ontology.createOntology({ name: 'demo', createdBy: 'cli' });
  const oid = onto.id;
  await ontology.addObjectType(oid, {
    id: 'ot.customer',
    displayName: 'Customer',
    propertyTypeIds: [],
  });
  await ontology.addObjectType(oid, {
    id: 'ot.product',
    displayName: 'Product',
    propertyTypeIds: [],
  });
  await ontology.addObjectType(oid, {
    id: 'ot.sales-order',
    displayName: 'Sales Order',
    propertyTypeIds: [],
  });
  await ontology.addActionType(oid, APPROVE);
  await ontology.addActionType(oid, CREATE_ORDER);
  await ontology.addActionType(oid, REPORT);
  await ontology.commit({ ontologyId: oid, createdBy: 'cli' });

  await objects.create({
    ontologyId: oid,
    objectTypeId: 'ot.customer',
    primaryKey: 'C-1',
    properties: { name: 'ACME' },
  });
  await objects.create({
    ontologyId: oid,
    objectTypeId: 'ot.product',
    primaryKey: 'P-1',
    properties: { sku: 'SKU-1' },
  });
  await objects.create({
    ontologyId: oid,
    objectTypeId: 'ot.sales-order',
    primaryKey: 'SO-1',
    properties: { status: 'pending', amount: 150 },
  });
  await objects.create({
    ontologyId: oid,
    objectTypeId: 'ot.sales-order',
    primaryKey: 'SO-gate',
    properties: { status: 'pending', amount: 10 },
  });

  const exec = createActionExecutor({
    objects,
    links,
    audit,
    ontology,
    clock,
    nextId,
    authorize: (req) =>
      req.principal === 'eve'
        ? { decision: 'deny', principalEpids: [], resourceEpid: null, reason: 'unauthorized' }
        : { decision: 'allow', principalEpids: [], resourceEpid: null, reason: 'ok' },
  });

  log('== 1. unauthorized → DENIED ==');
  const denied = await exec.apply({
    ontologyId: oid,
    actionApiName: 'approve-sales-order',
    parameters: { orderId: 'SO-gate', status: 'approved' },
    principal: 'eve',
    idempotencyKey: 'deny-cli',
    expectedObjectVersions: { 'ot.sales-order::SO-gate': 1 },
  });
  log(`  status=${denied.status} error=${denied.error} audit=${denied.auditEntryId}`);

  log('== 2. apply + idempotencyKey ==');
  const first = await exec.apply({
    ontologyId: oid,
    actionApiName: 'approve-sales-order',
    parameters: { orderId: 'SO-1', status: 'approved' },
    principal: 'alice',
    idempotencyKey: 'approve-SO-1',
    expectedObjectVersions: { 'ot.sales-order::SO-1': 1 },
  });
  const again = await exec.apply({
    ontologyId: oid,
    actionApiName: 'approve-sales-order',
    parameters: { orderId: 'SO-1', status: 'approved' },
    principal: 'alice',
    idempotencyKey: 'approve-SO-1',
    expectedObjectVersions: { 'ot.sales-order::SO-1': 1 },
  });
  log(`  first=${first.status} again=${again.status} sameId=${first.executionId === again.executionId}`);

  log('== 3. stale expectedObjectVersions → conflict ==');
  const stale = await exec.apply({
    ontologyId: oid,
    actionApiName: 'approve-sales-order',
    parameters: { orderId: 'SO-gate', status: 'approved' },
    principal: 'alice',
    idempotencyKey: 'stale-cli',
    expectedObjectVersions: { 'ot.sales-order::SO-gate': 99 },
  });
  log(`  status=${stale.status} error=${stale.error}`);

  log('== 4. audit completo ==');
  const entries = await audit.list();
  const kinds = entries
    .map((e) => {
      try {
        return JSON.parse(e.eventData ?? '{}') as { kind?: string };
      } catch {
        return {};
      }
    })
    .map((p) => p.kind)
    .filter((k): k is string => Boolean(k));
  log(`  kinds=${kinds.join(',')}`);
  const verify = await audit.verify();
  log(`  chain.ok=${verify.ok}`);

  log('== 5. parameter tree + variable binding ==');
  const tree = await exec.parameterTree!({
    ontologyId: oid,
    actionApiName: 'approve-sales-order',
    parameters: { orderId: 'SO-1', status: 'approved' },
    principal: 'alice',
  });
  const rebound = applyDefVariableBindings(APPROVE, { orderId: 'SO-1', status: 'x' }, 'order_status', 'held');
  log(`  nodes=${tree.nodes.map((n) => n.name).join(',')} bound.status=${rebound.status}`);

  log('== 6. document from object (US 9,223,773) ==');
  const rendered = renderDocumentTemplate('Customer {{name}} sku={{sku}}', {
    name: 'ACME',
    sku: 'SKU-1',
  });
  const report = await exec.apply({
    ontologyId: oid,
    actionApiName: 'order-report',
    parameters: { orderId: 'SO-1' },
    principal: 'alice',
    idempotencyKey: 'report-cli',
    expectedObjectVersions: { 'ot.sales-order::SO-1': 2 },
  });
  const so1 = await objects.get(oid, 'ot.sales-order', 'SO-1');
  log(`  template="${rendered}" report.status=${report.status} doc=${String(so1?.properties.report ?? '')}`);

  log('== 7. workflow ordenado (create → approve) ==');
  const runner = createActionWorkflowRunner(exec);
  const wf = await runner.apply({
    ontologyId: oid,
    workflow: {
      id: 'wf.fulfill',
      displayName: 'Fulfill',
      steps: [
        {
          id: 'create',
          actionApiName: 'create-sales-order',
          parameterBindings: { orderId: '$orderId', amount: '$amount', status: 'pending' },
        },
        {
          id: 'approve',
          actionApiName: 'approve-sales-order',
          parameterBindings: { orderId: '$orderId', status: '$status' },
          dependsOn: ['create'],
        },
      ],
    },
    parameters: { orderId: 'SO-new', amount: 42, status: 'approved' },
    principal: 'alice',
    idempotencyKey: 'wf-1',
    expectedObjectVersions: { 'ot.sales-order::SO-new': 1 },
  });
  const created = await objects.get(oid, 'ot.sales-order', 'SO-new');
  log(`  wf=${wf.status} steps=${wf.stepResults.length} SO-new.status=${String(created?.properties.status ?? '')}`);

  const ok =
    denied.status === 'DENIED' &&
    Boolean(denied.auditEntryId) &&
    first.status === 'SUCCEEDED' &&
    again.executionId === first.executionId &&
    stale.status === 'FAILED' &&
    /version conflict/i.test(stale.error ?? '') &&
    kinds.includes('ActionDenied') &&
    kinds.includes('ActionApplied') &&
    kinds.includes('ActionFailed') &&
    verify.ok &&
    tree.nodes.some((n) => n.name === 'orderId' && n.type === 'object_reference') &&
    rebound.status === 'held' &&
    rendered === 'Customer ACME sku=SKU-1' &&
    report.status === 'SUCCEEDED' &&
    String(so1?.properties.report ?? '').includes('status=approved') &&
    wf.status === 'SUCCEEDED' &&
    created?.properties.status === 'approved';

  log(ok ? 'demo ok — Action engine: denied / idempotency / conflict / audit' : 'demo FAIL');
  return ok ? 0 : 1;
}

export async function runWritebackDemo(
  log: (message: string) => void = console.log,
): Promise<number> {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const objects = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({ clock, nextId });
  const audit = createAuditLog({ clock, nextId });
  const events = createMemoryOperationalEventStore({ clock, nextId });
  const outbox = createMemoryOutboxRepository();
  const connector = demoSourceConnector();
  const mappings = demoMappings();

  log('== 1. observe fonte ==');
  const ontology = createOntologyRegistry({ clock, nextId });
  const onto = await ontology.createOntology({ name: 'wb', createdBy: 'cli' });
  const oid = onto.id;
  await ontology.addObjectType(oid, {
    id: 'ot.sales-order',
    displayName: 'Sales Order',
    propertyTypeIds: [],
  });
  await ontology.addActionType(oid, APPROVE);
  await ontology.commit({ ontologyId: oid, createdBy: 'cli' });
  const seed = sourceFieldsToProperties(connector.getRecord('SO-1') ?? {}, mappings);
  await objects.create({
    ontologyId: oid,
    objectTypeId: 'ot.sales-order',
    primaryKey: 'SO-1',
    properties: seed,
    source: 'ext',
  });
  log(`  object.status=${String(seed.status)} source=${String(connector.getRecord('SO-1')?.order_status)}`);

  const exec = createActionExecutor({
    objects,
    links,
    audit,
    ontology,
    clock,
    nextId,
    authorize: () => ({
      decision: 'allow',
      principalEpids: [],
      resourceEpid: null,
      reason: 'ok',
    }),
    events,
    outbox,
  });

  log('== 2. decide + act (Action apply) ==');
  const applied = await exec.apply({
    ontologyId: oid,
    actionApiName: 'approve-sales-order',
    parameters: { orderId: 'SO-1', status: 'approved' },
    principal: 'alice',
    idempotencyKey: 'approve-SO-1',
    expectedObjectVersions: { 'ot.sales-order::SO-1': 1 },
  });
  log(`  action=${applied.status} audit=${applied.auditEntryId}`);

  log('== 3. write-back pelo connector ==');
  const { drained } = await drainWriteBackToConnector({
    outboxRecords: outbox.records,
    connector,
    objects,
    ontologyId: oid,
    objectTypeId: 'ot.sales-order',
    mappings,
    events,
    audit,
    principal: 'alice',
  });
  const srcAfter = connector.getRecord('SO-1');
  const objAfter = await objects.get(oid, 'ot.sales-order', 'SO-1');
  log(`  drained=${drained} source=${String(srcAfter?.order_status)} object=${String(objAfter?.properties.status)} v=${objAfter?.version}`);

  log('== 4. audit do ciclo ==');
  const kinds = (await events.list()).map((e) => e.kind);
  const auditKinds = (await audit.list())
    .map((e) => {
      try {
        return JSON.parse(e.eventData ?? '{}') as { kind?: string };
      } catch {
        return {};
      }
    })
    .map((p) => p.kind)
    .filter((k): k is string => Boolean(k));
  log(`  events=${kinds.join(',')}`);
  log(`  audit=${auditKinds.join(',')}`);
  const verify = await audit.verify();

  const ok =
    applied.status === 'SUCCEEDED' &&
    Boolean(applied.auditEntryId) &&
    drained === 1 &&
    srcAfter?.order_status === 'approved' &&
    objAfter?.properties.status === 'approved' &&
    (objAfter?.version ?? 0) > 1 &&
    kinds.includes('ExternalWritebackRequested') &&
    kinds.includes('ExternalWritebackSucceeded') &&
    auditKinds.includes('ActionApplied') &&
    auditKinds.includes('WriteBackConverged') &&
    verify.ok;

  log(ok ? 'demo ok — observe→act→write-back→fonte e objeto convergem no audit' : 'demo FAIL');
  return ok ? 0 : 1;
}

export async function runCommandLine(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') return runDemo(log);
  if (cmd === 'writeback') return runWritebackDemo(log);
  error(`comando desconhecido: ${cmd}`);
  log(USAGE);
  return 1;
}

function isMain(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
