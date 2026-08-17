/**
 * policy-engine — src/core/redaction-pipeline.ts
 * Passo 27 e2e: lineage colunar → grafo → redaction sanitizada.
 *
 * Domínio neutro (vendas). Sem investigação, GUI, vector clocks ou import.
 */

import type { GraphObject, SanitizedGraph, TypedLink } from 'contracts';
import { createColumnLineageStore } from 'data-lineage';
import {
  detectRedactionCriteria,
  redactGraph,
  sanitizedContainsValue,
} from 'knowledge-graph';

const SECRET_EMAIL = 'c1@internal.example';

export interface RedactDemoResult {
  ok: boolean;
  emailColumnClass: string;
  amountColumnClass: string;
  customerEmailColumnClass: string;
  detectedCriteria: string[];
  alice: SanitizedGraph;
  bob: SanitizedGraph;
  bobHasEmail: boolean;
  bobHasNote: boolean;
  bobDangling: boolean;
  bobLeaksEmail: boolean;
  aliceHasEmail: boolean;
  aliceHasNote: boolean;
}

function seedSalesGraph(): { nodes: GraphObject[]; links: TypedLink[] } {
  const customer: GraphObject = {
    id: 'obj-c1',
    objectTypeId: 'ot.customer',
    primaryKey: 'C1',
    sourceSystem: 'crm',
    classification: 'Unclassified',
    provenance: ['crm'],
    properties: { id: 'C1', name: 'Acme', email: SECRET_EMAIL },
    propertyClassifications: { email: 'Confidential' },
  };
  const order: GraphObject = {
    id: 'obj-so1',
    objectTypeId: 'ot.sales_order',
    primaryKey: 'SO-1',
    sourceSystem: 'erp',
    classification: 'Unclassified',
    provenance: ['erp'],
    properties: { id: 'SO-1', amount: 1200, customer_email: SECRET_EMAIL },
    propertyClassifications: { customer_email: 'Confidential', amount: 'Unclassified' },
  };
  const note: GraphObject = {
    id: 'obj-note',
    objectTypeId: 'ot.internal_note',
    primaryKey: 'N1',
    sourceSystem: 'crm',
    classification: 'Confidential',
    provenance: ['crm'],
    properties: { text: 'follow-up on Acme' },
  };
  const links: TypedLink[] = [
    {
      id: 'link-placed',
      linkTypeId: 'lt.placed',
      sourceObjectId: customer.id,
      targetObjectId: order.id,
      mappingVersionId: 'mv-redact-1',
      sourceDatasetId: 'customers',
      targetDatasetId: 'orders_enriched',
    },
    {
      id: 'link-annotated',
      linkTypeId: 'lt.annotated',
      sourceObjectId: customer.id,
      targetObjectId: note.id,
      mappingVersionId: 'mv-redact-1',
    },
  ];
  return { nodes: [customer, order, note], links };
}

export function runRedactionPipeline(): RedactDemoResult {
  const cols = createColumnLineageStore();
  cols.registerColumn({
    versionId: 'customers-v1',
    column: 'email',
    classification: 'Confidential',
  });
  cols.registerColumn({
    versionId: 'customers-v1',
    column: 'name',
    classification: 'Unclassified',
  });
  cols.registerColumn({
    versionId: 'orders-v1',
    column: 'amount',
    classification: 'Unclassified',
  });
  cols.recordColumnMappings({
    pipelineRunId: 'run-join-1',
    derivationProgramId: 'xform-join-customers-orders-v1',
    mappings: [
      {
        sources: [{ versionId: 'customers-v1', column: 'email' }],
        target: { versionId: 'orders-enriched-v1', column: 'customer_email' },
      },
      {
        sources: [{ versionId: 'orders-v1', column: 'amount' }],
        target: { versionId: 'orders-enriched-v1', column: 'amount' },
      },
    ],
  });

  const emailColumnClass = cols.effectiveColumnClassification({
    versionId: 'customers-v1',
    column: 'email',
  });
  const amountColumnClass = cols.effectiveColumnClassification({
    versionId: 'orders-enriched-v1',
    column: 'amount',
  });
  const customerEmailColumnClass = cols.effectiveColumnClassification({
    versionId: 'orders-enriched-v1',
    column: 'customer_email',
  });

  const { nodes, links } = seedSalesGraph();
  const detected = detectRedactionCriteria(nodes);

  const alice = redactGraph(nodes, links, { viewingLevel: 'Confidential' });
  const bob = redactGraph(nodes, links, { viewingLevel: 'Unclassified' });

  const bobNodeIds = new Set(bob.nodes.map((n) => n.id));
  const bobHasEmail = bob.nodes.some(
    (n) => n.properties && ('email' in n.properties || 'customer_email' in n.properties),
  );
  const bobHasNote = bobNodeIds.has('obj-note');
  const bobDangling = bob.links.some(
    (l) => !bobNodeIds.has(l.sourceObjectId) || !bobNodeIds.has(l.targetObjectId),
  );
  const bobLeaksEmail = sanitizedContainsValue(bob, SECRET_EMAIL);
  const aliceHasEmail = alice.nodes.some((n) => n.properties && 'email' in n.properties);
  const aliceHasNote = alice.nodes.some((n) => n.id === 'obj-note');

  const bobPlaced = bob.links.some((l) => l.id === 'link-placed');
  const bobAnnotated = bob.links.some((l) => l.id === 'link-annotated');
  const alicePlaced = alice.links.some((l) => l.id === 'link-placed');
  const aliceAnnotated = alice.links.some((l) => l.id === 'link-annotated');

  const ok =
    emailColumnClass === 'Confidential' &&
    amountColumnClass === 'Unclassified' &&
    customerEmailColumnClass === 'Confidential' &&
    !bobHasEmail &&
    !bobHasNote &&
    !bobDangling &&
    !bobLeaksEmail &&
    bobPlaced &&
    !bobAnnotated &&
    aliceHasEmail &&
    aliceHasNote &&
    alicePlaced &&
    aliceAnnotated &&
    bob.redactedNodeIds.includes('obj-note') &&
    bob.redactedLinkIds.includes('link-annotated') &&
    bob.redactedProperties.some((p) => p.property === 'email');

  return {
    ok,
    emailColumnClass,
    amountColumnClass,
    customerEmailColumnClass,
    detectedCriteria: detected.map((c) => c.kind),
    alice,
    bob,
    bobHasEmail,
    bobHasNote,
    bobDangling,
    bobLeaksEmail,
    aliceHasEmail,
    aliceHasNote,
  };
}
