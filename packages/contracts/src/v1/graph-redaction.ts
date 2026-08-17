/**
 * contracts — src/v1/graph-redaction.ts
 * Redaction de grafo (Passo 27). Shape congelado.
 *
 * US 9,501,761 — grafo redigido: omite nós/arestas/propriedades sem permissão;
 *   repara arestas soltas; entrega snapshot sanitizado (sem GUI de preview).
 * US 9,857,960 / US 10,222,965 / US 11,327,641 — critérios: classificação,
 *   proveniência, tipo de objeto, tipo de propriedade. Sem estágios visuais.
 *
 * Import/deconflict/vector clocks (US 12,386,496 / US20250328230A1) ficam fora
 * deste gate. Live graph não é mutado: redação é cópia.
 */

import type { GraphObject, IntegrityIssue, IntegrityReport, TypedLink } from './knowledge-graph.js';

/** Critérios de redação detectáveis a partir dos metadados do grafo. */
export type RedactionCriterionKind =
  | 'access_control'
  | 'provenance'
  | 'object_type'
  | 'property_type';

export interface RedactionCriterion {
  kind: RedactionCriterionKind;
  values: string[];
  /**
   * true (default) = redatar o que casa; false = redatar o que não casa.
   */
  redactMatching?: boolean;
}

export interface RedactionRequest {
  /** Viewing level do principal (obrigatório para o gate). */
  viewingLevel: string;
  /** Critérios extras (proveniência, tipo, propriedade). */
  criteria?: RedactionCriterion[];
  /**
   * Overlay objectId → property → classification.
   * Usado quando a marcação colunar não está no GraphObject.
   */
  propertyClassifications?: Record<string, Record<string, string>>;
}

export interface RedactedProperty {
  objectId: string;
  property: string;
}

/** Snapshot sanitizado — nós visíveis, propriedades filtradas, arestas sem pontas soltas. */
export interface SanitizedGraph {
  viewingLevel: string;
  nodes: GraphObject[];
  links: TypedLink[];
  redactedNodeIds: string[];
  redactedLinkIds: string[];
  redactedProperties: RedactedProperty[];
}

export function buildGoldenRedactionCriterion(): RedactionCriterion {
  return {
    kind: 'property_type',
    values: ['email'],
    redactMatching: true,
  };
}

export function assertRedactionRequest(req: RedactionRequest): void {
  if (!req.viewingLevel) throw new Error('RedactionRequest: viewingLevel obrigatório');
}

export function assertSanitizedGraph(graph: SanitizedGraph): IntegrityReport {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const issues: IntegrityIssue[] = [];
  for (const link of graph.links) {
    if (!ids.has(link.sourceObjectId)) {
      issues.push({
        kind: 'dangling_source',
        linkId: link.id,
        detail: `source ausente: ${link.sourceObjectId}`,
      });
    }
    if (!ids.has(link.targetObjectId)) {
      issues.push({
        kind: 'dangling_target',
        linkId: link.id,
        detail: `target ausente: ${link.targetObjectId}`,
      });
    }
  }
  return {
    ok: issues.length === 0,
    linkCount: graph.links.length,
    objectCount: graph.nodes.length,
    issues,
  };
}
