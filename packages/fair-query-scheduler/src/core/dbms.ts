/**
 * fair-query-scheduler — src/core/dbms.ts
 *
 * Implementa funcionalmente o componente da patente US 9.092.482 B2 referente
 * ao SISTEMA GERENCIADOR DE BANCO DE DADOS (DBMS) MULTI-NÓ sobre o qual as
 * sub-query tasks são executadas. Aqui é um DBMS SIMULADO em memória: tabelas
 * com linhas ordenadas por chave numérica, execução de SubQueryTask
 * ({ whereAfter?, limit } — keyset/seek pagination) e latência simulada
 * determinística via Clock injetável (baseMs + perRowMs * linhas retornadas).
 * Suporta múltiplos nós para o mecanismo de migração de nó.
 */

import type { Clock, Row, SubQueryTask } from './types.js';

/** Configuração de latência simulada de um nó. */
export interface NodeLatencyConfig {
  /** Latência fixa por sub-query task (ms). */
  baseMs: number;
  /** Latência por linha retornada (ms). */
  perRowMs: number;
}

export const DEFAULT_LATENCY: NodeLatencyConfig = { baseMs: 5, perRowMs: 1 };

/**
 * Nó de banco de dados simulado. Mantém tabelas (nome → linhas ordenadas por
 * `id` crescente, chaves únicas) e executa sub-query tasks com seek pagination.
 */
export class DatabaseNode {
  readonly id: string;
  readonly latency: NodeLatencyConfig;
  private readonly tables = new Map<string, Row[]>();

  constructor(id: string, tables: Record<string, Row[]> = {}, latency: NodeLatencyConfig = DEFAULT_LATENCY) {
    if (!id) throw new Error('DatabaseNode: id do nó é obrigatório');
    this.id = id;
    this.latency = { ...latency };
    for (const [name, rows] of Object.entries(tables)) {
      this.addTable(name, rows);
    }
  }

  /** Cria/valida uma tabela: ordena por id e exige chaves únicas. */
  addTable(name: string, rows: Row[]): void {
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.id === sorted[i - 1]!.id) {
        throw new Error(`DatabaseNode(${this.id}): chave duplicada ${sorted[i]!.id} na tabela "${name}"`);
      }
    }
    this.tables.set(name, sorted);
  }

  /** Número estimado de linhas de uma tabela (usado pelo CostEstimator). */
  estimatedCount(table: string): number {
    return this.tables.get(table)?.length ?? 0;
  }

  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  /**
   * Executa uma sub-query task sobre a tabela `query`:
   *   SELECT * FROM query WHERE id > (after ?? -∞) ORDER BY id ASC LIMIT limit
   * A latência simulada (baseMs + perRowMs * linhas retornadas) é aplicada
   * avançando o Clock injetável — determinismo total, sem timers reais.
   */
  execute(query: string, task: SubQueryTask, clock: Clock): Row[] {
    const table = this.tables.get(query);
    if (!table) {
      throw new Error(`DatabaseNode(${this.id}): tabela "${query}" não existe`);
    }
    const after = task.after ?? Number.NEGATIVE_INFINITY;
    const out: Row[] = [];
    for (const row of table) {
      if (row.id <= after) continue;
      out.push(row);
      if (out.length >= task.limit) break;
    }
    clock.advance(this.latency.baseMs + this.latency.perRowMs * out.length);
    return out;
  }
}

/**
 * DBMS multi-nó simulado: conjunto nomeado de DatabaseNode, com nó padrão
 * (o primeiro registrado). Usado pelo scheduler para atribuir sub-tasks a
 * nós e para o mecanismo de migração entre nós.
 */
export class DatabaseManagementSystem {
  private readonly nodes = new Map<string, DatabaseNode>();

  constructor(nodes: DatabaseNode[] = []) {
    for (const n of nodes) this.addNode(n);
  }

  addNode(node: DatabaseNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`DatabaseManagementSystem: nó "${node.id}" já existe`);
    }
    this.nodes.set(node.id, node);
  }

  node(id: string): DatabaseNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`DatabaseManagementSystem: nó "${id}" não existe`);
    return n;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  get nodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  /** Nó padrão: o primeiro registrado. */
  get defaultNode(): string {
    const first = this.nodes.keys().next();
    if (first.done) throw new Error('DatabaseManagementSystem: nenhum nó registrado');
    return first.value;
  }

  get size(): number {
    return this.nodes.size;
  }
}
