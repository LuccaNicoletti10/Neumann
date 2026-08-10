/** Utilitários compartilhados dos testes (não é um arquivo de teste). */
import { DatabaseManagementSystem, DatabaseNode } from '../src/core/dbms.js';
import type { Row } from '../src/core/types.js';

export function genRows(n: number, prefix = 'row'): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, value: `${prefix}-${i + 1}` }));
}

/** DBMS com um único nó ("node-a"): tabela "t" com n linhas + "small" com 10. */
export function singleNodeDbms(n: number): DatabaseManagementSystem {
  return new DatabaseManagementSystem([
    new DatabaseNode('node-a', { t: genRows(n), small: genRows(10, 's') }),
  ]);
}

/** DBMS com dois nós ("node-a" e "node-b") contendo a mesma tabela "t". */
export function twoNodeDbms(n: number): DatabaseManagementSystem {
  return new DatabaseManagementSystem([
    new DatabaseNode('node-a', { t: genRows(n) }),
    new DatabaseNode('node-b', { t: genRows(n) }),
  ]);
}
