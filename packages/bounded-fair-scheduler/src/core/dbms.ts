// bounded-fair-scheduler — DBMS simulado multi-nó.
// Implementa funcionalmente, de forma independente, o componente "sistema gerenciador de
// banco de dados com múltiplos nós que executa sub-consultas com rate limiter e seek"
// descrito na patente US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads").
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original dos mecanismos.

import type { AdvanceableClock, Row } from './types.js';

/** Pedido de execução de sub-tarefa: keyset seek (after) + rate limiter (limit). */
export interface NodeTaskRequest {
  after: number | null;
  limit: number;
}

/**
 * Nó de banco de dados simulado: mantém linhas ordenadas por id e executa
 * sub-tarefas { after?, limit }. A latência é determinística e debitada no
 * Clock injetado: baseMs + perRowMs * rowsRetornadas.
 */
export class DatabaseNode {
  readonly name: string;
  private readonly rows: Row[];
  private readonly baseMs: number;
  private readonly perRowMs: number;

  constructor(name: string, rows: Row[], baseMs = 5, perRowMs = 1) {
    this.name = name;
    this.baseMs = baseMs;
    this.perRowMs = perRowMs;
    this.rows = [...rows].sort((a, b) => a.id - b.id);
  }

  rowCount(): number {
    return this.rows.length;
  }

  /**
   * Executa a sub-tarefa e retorna até `limit` linhas com id > after
   * (ou desde o início quando after === null). Avança o relógio com a
   * latência simulada determinística.
   */
  execute(task: NodeTaskRequest, clock: AdvanceableClock): Row[] {
    if (task.limit < 1) throw new Error('DatabaseNode.execute: limit deve ser >= 1');
    let start = 0;
    if (task.after !== null) {
      // busca binária pelo primeiro id > after (seek pagination)
      let lo = 0;
      let hi = this.rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const row = this.rows[mid];
        if (row !== undefined && row.id <= task.after) lo = mid + 1;
        else hi = mid;
      }
      start = lo;
    }
    const out = this.rows.slice(start, start + task.limit);
    clock.advance(this.baseMs + this.perRowMs * out.length);
    return out;
  }
}

/**
 * DBMS multi-nó simulado: conjunto nomeado de DatabaseNode.
 * Por padrão (uniform) todos os nós têm réplica idêntica das linhas,
 * o que permite migrar um job de um nó A para um nó B sem perda.
 */
export class DatabaseManagementSystem {
  private readonly nodes = new Map<string, DatabaseNode>();

  constructor(nodes: DatabaseNode[]) {
    if (nodes.length === 0) throw new Error('DBMS precisa de ao menos um nó');
    for (const n of nodes) {
      if (this.nodes.has(n.name)) throw new Error(`Nó duplicado: ${n.name}`);
      this.nodes.set(n.name, n);
    }
  }

  /** Cria DBMS com réplicas idênticas das linhas em cada nó. */
  static uniform(
    nodeNames: string[],
    rows: Row[],
    baseMs = 5,
    perRowMs = 1,
  ): DatabaseManagementSystem {
    return new DatabaseManagementSystem(
      nodeNames.map((name) => new DatabaseNode(name, rows, baseMs, perRowMs)),
    );
  }

  nodeNames(): string[] {
    return [...this.nodes.keys()];
  }

  node(name: string): DatabaseNode {
    const n = this.nodes.get(name);
    if (!n) throw new Error(`Nó desconhecido: ${name}`);
    return n;
  }

  has(name: string): boolean {
    return this.nodes.has(name);
  }

  execute(nodeName: string, task: NodeTaskRequest, clock: AdvanceableClock): Row[] {
    return this.node(nodeName).execute(task, clock);
  }
}