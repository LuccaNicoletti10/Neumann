/**
 * transformation-runner — src/core/dag.ts
 * DAG de table definitions (leaf = source, non-leaf = transform).
 */

export type NodeKind = 'LEAF' | 'NON_LEAF';

export interface DagNode {
  id: string;
  name: string;
  kind: NodeKind;
  parents: string[];
  children: string[];
}

export interface TransformDag {
  nodes: Map<string, DagNode>;
  roots: string[];
  leaves: string[];
}

export function createEmptyDag(): TransformDag {
  return { nodes: new Map(), roots: [], leaves: [] };
}

export function addNode(dag: TransformDag, node: DagNode): void {
  dag.nodes.set(node.id, node);
  recomputeEnds(dag);
}

export function link(dag: TransformDag, parentId: string, childId: string): void {
  const parent = dag.nodes.get(parentId);
  const child = dag.nodes.get(childId);
  if (!parent || !child) throw new Error('link: nó inexistente');
  if (!parent.children.includes(childId)) parent.children.push(childId);
  if (!child.parents.includes(parentId)) child.parents.push(parentId);
  recomputeEnds(dag);
}

function recomputeEnds(dag: TransformDag): void {
  dag.roots = [];
  dag.leaves = [];
  for (const n of dag.nodes.values()) {
    if (n.parents.length === 0) dag.roots.push(n.id);
    if (n.children.length === 0) dag.leaves.push(n.id);
  }
}

/** Detecta ciclo (true = tem ciclo). */
export function hasCycle(dag: TransformDag): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = dag.nodes.get(id);
    if (node) {
      for (const c of node.children) {
        if (dfs(c)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of dag.nodes.keys()) {
    if (dfs(id)) return true;
  }
  return false;
}

/** Constrói DAG linear: source → step0 → step1 → … */
export function buildLinearDag(
  programId: string,
  startWith: string,
  stepNames: readonly string[],
): TransformDag {
  const dag = createEmptyDag();
  const sourceId = `${programId}:src`;
  addNode(dag, {
    id: sourceId,
    name: startWith,
    kind: 'LEAF',
    parents: [],
    children: [],
  });
  let prev = sourceId;
  for (let i = 0; i < stepNames.length; i++) {
    const id = `${programId}:s${i}`;
    addNode(dag, {
      id,
      name: stepNames[i]!,
      kind: 'NON_LEAF',
      parents: [],
      children: [],
    });
    link(dag, prev, id);
    prev = id;
  }
  return dag;
}
