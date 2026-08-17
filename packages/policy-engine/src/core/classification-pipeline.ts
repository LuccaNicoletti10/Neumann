/**
 * policy-engine — src/core/classification-pipeline.ts
 * Passo 26 e2e: 2 connectors → lineage inherit → objects + cross-source link → dissemination.
 *
 * Sem map GUI, share URLs, MFA, vaults ou exploração/cohort.
 */

import {
  classificationFromPolicyTags,
  classificationPolicyTag,
  disseminationView,
  sharingConstraint,
  type CanonicalEvent,
} from 'contracts';
import { createMemoryWriteBackConnector } from 'connector-sdk';
import { createDeterministicClock, createIdGenerator, createLineageStore } from 'data-lineage';
import { createKnowledgeGraph } from 'knowledge-graph';

import { createOntologyAuthorizer } from './ontology-authorizer.js';

export interface ClassifyDemoResult {
  ok: boolean;
  derivedClassification: string;
  objectClassification: string;
  linkConstraint: string;
  aliceVisible: string[];
  bobVisible: string[];
  bobSeesDerived: boolean;
  aliceSeesLink: boolean;
  bobSeesLink: boolean;
}

async function collectSnapshot(
  connector: { snapshot: (obj: { sourceSystem: string; objectName: string }) => AsyncIterable<CanonicalEvent> },
  sourceSystem: string,
  objectName: string,
): Promise<CanonicalEvent[]> {
  const out: CanonicalEvent[] = [];
  for await (const ev of connector.snapshot({ sourceSystem, objectName })) {
    out.push(ev);
  }
  return out;
}

export async function runClassificationPipeline(): Promise<ClassifyDemoResult> {
  const crm = createMemoryWriteBackConnector({
    connectorId: 'csv-crm',
    sourceSystem: 'crm',
    objectName: 'customers',
    defaultPolicyTags: [classificationPolicyTag('Confidential')],
    records: {
      C1: { name: 'Acme', region: 'south' },
    },
  });
  const erp = createMemoryWriteBackConnector({
    connectorId: 'http-erp',
    sourceSystem: 'erp',
    objectName: 'orders',
    defaultPolicyTags: [classificationPolicyTag('Unclassified')],
    records: {
      'SO-1': { customer_id: 'C1', amount: 150, status: 'open' },
    },
  });

  const customers = await collectSnapshot(crm, 'crm', 'customers');
  const orders = await collectSnapshot(erp, 'erp', 'orders');
  const custClass = classificationFromPolicyTags(customers[0]?.policy_tags).name;
  const orderClass = classificationFromPolicyTags(orders[0]?.policy_tags).name;

  const lineage = createLineageStore({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });
  lineage.registerRaw({
    versionId: 'customers-v1',
    datasetId: 'customers',
    datasetName: 'customers',
    versionNumber: 1,
    contentHash: customers[0]?.payload_hash ?? 'a'.repeat(64),
    createdBy: 'csv-crm',
    classification: custClass,
  });
  lineage.registerRaw({
    versionId: 'orders-v1',
    datasetId: 'orders',
    datasetName: 'orders',
    versionNumber: 1,
    contentHash: orders[0]?.payload_hash ?? 'b'.repeat(64),
    createdBy: 'http-erp',
    classification: orderClass,
  });
  lineage.recordRun({
    inputVersions: ['customers-v1', 'orders-v1'],
    outputVersion: 'orders-enriched-v1',
    datasetId: 'orders_enriched',
    datasetName: 'orders_enriched',
    versionNumber: 1,
    derivationProgramId: 'xform-join-customer-order-v1',
    contentHash: 'c'.repeat(64),
    durationMs: 12,
  });

  const derived = lineage.getVersion('orders-enriched-v1');
  const derivedClassification = derived?.classification ?? 'Unclassified';

  const graph = createKnowledgeGraph({
    clock: createDeterministicClock('2024-06-01T12:00:00.000Z'),
    nextId: createIdGenerator(),
  });
  graph.upsertObject({
    id: 'obj-cust-C1',
    objectTypeId: 'ot.customer',
    primaryKey: 'C1',
    sourceSystem: 'crm',
    classification: custClass,
    properties: { name: 'Acme' },
  });
  graph.upsertObject({
    id: 'obj-ord-SO-1',
    objectTypeId: 'ot.sales_order',
    primaryKey: 'SO-1',
    sourceSystem: 'erp',
    classification: orderClass,
    properties: { amount: 150 },
  });
  graph.upsertObject({
    id: 'obj-enriched-SO-1',
    objectTypeId: 'ot.order_enriched',
    primaryKey: 'SO-1',
    sourceSystem: 'pipeline',
    classification: derivedClassification,
    properties: { customer: 'Acme', amount: 150 },
  });
  graph.upsertLink({
    linkTypeId: 'lt.placed',
    sourceObjectId: 'obj-cust-C1',
    targetObjectId: 'obj-ord-SO-1',
    mappingVersionId: 'mapv-1',
    sourceDatasetId: 'customers',
    targetDatasetId: 'orders',
  });

  const cust = graph.getObject('obj-cust-C1');
  const ord = graph.getObject('obj-ord-SO-1');
  const linkConstraint = sharingConstraint(cust?.classification, ord?.classification).name;

  const authorizer = createOntologyAuthorizer({
    everyoneRole: 'reader',
    roles: { alice: ['analyst'], bob: ['analyst'] },
    grants: [
      {
        role: 'reader',
        objectTypes: ['*'],
        operations: ['read'],
      },
    ],
    maxClassification: {
      alice: 'Confidential',
      bob: 'Unclassified',
    },
  });

  const universe = graph.listObjects().map((o) => ({
    id: o.id,
    objectTypeId: o.objectTypeId,
    classification: o.classification,
    sourceSystem: o.sourceSystem,
  }));
  const aliceItems = authorizer.filterReadable('alice', universe);
  const bobItems = authorizer.filterReadable('bob', universe);
  const aliceView = disseminationView(universe, 'Confidential');
  const bobView = disseminationView(universe, 'Unclassified');

  const aliceTrav = graph.traverseLinks({
    startObjectId: 'obj-cust-C1',
    maxHops: 1,
    viewingLevel: 'Confidential',
  });
  const bobTrav = graph.traverseLinks({
    startObjectId: 'obj-cust-C1',
    maxHops: 1,
    viewingLevel: 'Unclassified',
  });
  const bobFromOrder = graph.traverseLinks({
    startObjectId: 'obj-ord-SO-1',
    maxHops: 1,
    viewingLevel: 'Unclassified',
  });

  const aliceSeesDerived = aliceItems.some((i) => i.id === 'obj-enriched-SO-1');
  const bobSeesDerived = bobItems.some((i) => i.id === 'obj-enriched-SO-1');
  const aliceDenied = authorizer.authorize({
    principal: 'alice',
    resource: 'object:ot.order_enriched',
    operation: 'read',
    context: { classification: derivedClassification },
  });
  const bobDenied = authorizer.authorize({
    principal: 'bob',
    resource: 'object:ot.order_enriched',
    operation: 'read',
    context: { classification: derivedClassification },
  });

  const ok =
    custClass === 'Confidential' &&
    orderClass === 'Unclassified' &&
    derivedClassification === 'Confidential' &&
    linkConstraint === 'Confidential' &&
    aliceSeesDerived &&
    !bobSeesDerived &&
    aliceDenied.decision === 'allow' &&
    bobDenied.decision === 'deny' &&
    aliceView.items.length === 3 &&
    bobView.items.length === 1 &&
    bobView.items[0]?.id === 'obj-ord-SO-1' &&
    aliceTrav.hops.length === 1 &&
    bobTrav.nodes.length === 0 &&
    bobFromOrder.hops.length === 0;

  return {
    ok,
    derivedClassification,
    objectClassification: graph.getObject('obj-enriched-SO-1')?.classification ?? '',
    linkConstraint,
    aliceVisible: aliceItems.map((i) => i.id).sort(),
    bobVisible: bobItems.map((i) => i.id).sort(),
    bobSeesDerived,
    aliceSeesLink: aliceTrav.hops.length > 0,
    bobSeesLink: bobTrav.hops.length > 0 || bobFromOrder.hops.length > 0,
  };
}
