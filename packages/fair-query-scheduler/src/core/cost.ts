/**
 * fair-query-scheduler — src/core/cost.ts
 *
 * Implementa funcionalmente o componente da patente US 9.092.482 B2 referente
 * à ESTIMATIVA DE CUSTO de um job request: o custo é o número esperado de
 * resultados da consulta. O estimador usa a estimativa informada no request
 * (costEstimate) ou, quando ausente/inválida, calcula a partir da contagem
 * estimada de linhas da tabela consultada no DBMS.
 */

import type { DatabaseManagementSystem } from './dbms.js';
import type { JobRequest } from './types.js';

export class CostEstimator {
  /**
   * @param dbms DBMS simulado usado para estimar custo por contagem da tabela
   *             quando o request não traz uma estimativa válida.
   */
  constructor(private readonly dbms?: DatabaseManagementSystem) {}

  /**
   * Retorna a estimativa de custo (número esperado de resultados) do request.
   * Usa `request.costEstimate` quando é um número finito >= 0; caso contrário,
   * estima pela contagem de linhas da tabela no nó indicado em
   * `params.node` (ou no nó padrão).
   */
  estimate(request: JobRequest): number {
    const provided = request.costEstimate;
    if (typeof provided === 'number' && Number.isFinite(provided) && provided >= 0) {
      return provided;
    }
    if (!this.dbms) {
      throw new Error(
        `CostEstimator: costEstimate inválido (${String(provided)}) e nenhum DBMS disponível para estimar`,
      );
    }
    const nodeParam = request.params?.['node'];
    const nodeId = typeof nodeParam === 'string' && this.dbms.hasNode(nodeParam)
      ? nodeParam
      : this.dbms.defaultNode;
    return this.dbms.node(nodeId).estimatedCount(request.query);
  }
}
