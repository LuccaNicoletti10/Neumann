/**
 * mcp-server — ActionTypeDef.parameters → JSON Schema.
 */
import type { ActionParameterDef, ActionTypeDef } from 'contracts';

function paramSchema(p: ActionParameterDef): Record<string, unknown> {
  switch (p.baseType) {
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'object_reference':
      return { type: 'string', description: `primary key of ${p.objectTypeId ?? 'object'}` };
    default:
      return { type: 'string' };
  }
}

export function actionToJsonSchema(def: ActionTypeDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, p] of Object.entries(def.parameters ?? {})) {
    properties[name] = { ...paramSchema(p), description: p.displayName ?? name };
    if (p.required !== false) required.push(name);
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
