/**
 * action-engine — src/core/parameter-tree.ts
 * Parameter tree + variable binding (US 8,732,574 / 9,058,315 / 9,880,987 / 10,706,220).
 */

import type {
  ActionParameterNode,
  ActionParameterTree,
  ActionTypeDef,
  ObjectRecord,
} from 'contracts';

export function apiNameOf(def: ActionTypeDef): string {
  return def.apiName ?? def.id;
}

export function buildParameterTree(
  def: ActionTypeDef,
  params: Record<string, unknown>,
  objects: Map<string, ObjectRecord> = new Map(),
): ActionParameterTree {
  const nodes: ActionParameterNode[] = [];
  for (const [name, p] of Object.entries(def.parameters ?? {})) {
    const value = params[name];
    if (p.baseType === 'object_reference' && p.objectTypeId) {
      const pk = value == null ? '' : String(value);
      const obj = objects.get(`${p.objectTypeId}::${pk}`);
      const children: ActionParameterNode[] = [];
      if (obj) {
        for (const [prop, propVal] of Object.entries(obj.properties)) {
          children.push({
            name: prop,
            value: propVal,
            type: 'primitive',
            children: [],
          });
        }
      }
      nodes.push({
        name,
        value,
        type: 'object_reference',
        objectTypeId: p.objectTypeId,
        referencedPrimaryKey: pk || undefined,
        variableName: p.variableName,
        children,
      });
      continue;
    }
    nodes.push({
      name,
      value,
      type: p.variableName ? 'variable' : 'primitive',
      variableName: p.variableName,
      children: [],
    });
  }
  return {
    actionApiName: apiNameOf(def),
    actionTypeId: def.id,
    nodes,
  };
}

export function bindParameterVariable(
  tree: ActionParameterTree,
  paramName: string,
  variableName: string,
): ActionParameterTree {
  return {
    ...tree,
    nodes: tree.nodes.map((n) =>
      n.name === paramName
        ? { ...n, type: 'variable', variableName }
        : n,
    ),
  };
}

/**
 * Set a shared variable: every bound node (and matching action param) gets `value`.
 * Returns a new parameter map suitable for Action apply.
 */
export function setVariable(
  tree: ActionParameterTree,
  variableName: string,
  value: unknown,
): { tree: ActionParameterTree; params: Record<string, unknown> } {
  const nodes = tree.nodes.map((n) =>
    n.variableName === variableName ? { ...n, value } : n,
  );
  const next: ActionParameterTree = { ...tree, nodes };
  return { tree: next, params: flattenParameterTree(next) };
}

export function flattenParameterTree(
  tree: ActionParameterTree,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const n of tree.nodes) {
    params[n.name] = n.value;
  }
  return params;
}

/** Apply ActionTypeDef.variableName bindings to a parameter map. */
export function applyDefVariableBindings(
  def: ActionTypeDef,
  params: Record<string, unknown>,
  variableName: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...params };
  for (const [name, p] of Object.entries(def.parameters ?? {})) {
    if (p.variableName === variableName) next[name] = value;
  }
  return next;
}
