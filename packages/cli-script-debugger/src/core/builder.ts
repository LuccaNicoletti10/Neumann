/**
 * cli-script-debugger — src/core/builder.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: BUILDER DO TRANSFORMATION SCRIPT —
 * define entidades como OBJETO ou PROPRIEDADE de objeto, condições baseadas
 * no data source e mappings de data items para ontology parameters, com
 * serialização/parsing JSON do script.
 */

import type { Condition, EntityDef, Mapping, ScriptDefinition } from './types.js';

/** Builder fluente do transformation script. */
export class ScriptBuilder {
  private readonly entities = new Map<string, EntityDef>();
  private readonly conditions: Condition[] = [];
  private readonly mappings: Mapping[] = [];

  constructor(private readonly scriptName: string) {
    if (!scriptName) throw new Error('builder: nome do script é obrigatório');
  }

  /** Define a entidade `name` como OBJETO do tipo `objectType`. */
  defineObject(name: string, objectType: string): this {
    this.entities.set(name, { kind: 'object', objectType });
    return this;
  }

  /** Define a entidade `name` como PROPRIEDADE `property` do objeto `objectType`. */
  defineProperty(name: string, objectType: string, property: string): this {
    this.entities.set(name, { kind: 'property', objectType, property });
    return this;
  }

  /** Adiciona uma condição baseada no data source. */
  addCondition(condition: Condition): this {
    this.conditions.push({ ...condition });
    return this;
  }

  /** Mapeia um campo de data item a um ontology parameter de uma entidade. */
  addMapping(mapping: Mapping): this {
    this.mappings.push({ ...mapping });
    return this;
  }

  /** Materializa a definição imutável do script. */
  build(): ScriptDefinition {
    return {
      name: this.scriptName,
      entities: Object.fromEntries(this.entities),
      conditions: this.conditions.map((c) => ({ ...c })),
      mappings: this.mappings.map((m) => ({ ...m })),
    };
  }

  /** Serializa o script em JSON. */
  toJSON(): string {
    return serializeScript(this.build());
  }
}

export function createScriptBuilder(name: string): ScriptBuilder {
  return new ScriptBuilder(name);
}

export function serializeScript(def: ScriptDefinition): string {
  return JSON.stringify(def, null, 2);
}

/** Faz o parsing e valida a estrutura de um script serializado em JSON. */
export function parseScript(json: string): ScriptDefinition {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('script inválido: esperado objeto JSON');
  }
  const o = raw as Record<string, unknown>;
  const name = o['name'];
  if (typeof name !== 'string' || name === '') {
    throw new Error('script inválido: campo "name" obrigatório');
  }
  const entitiesRaw = o['entities'];
  if (typeof entitiesRaw !== 'object' || entitiesRaw === null) {
    throw new Error('script inválido: campo "entities" obrigatório');
  }
  const entities: Record<string, EntityDef> = {};
  for (const [key, value] of Object.entries(entitiesRaw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`script inválido: entidade "${key}" deve ser objeto`);
    }
    const e = value as Record<string, unknown>;
    const kind = e['kind'];
    const objectType = e['objectType'];
    const property = e['property'];
    if (kind !== 'object' && kind !== 'property') {
      throw new Error(`script inválido: entidade "${key}" com kind inválido`);
    }
    if (typeof objectType !== 'string' || objectType === '') {
      throw new Error(`script inválido: entidade "${key}" sem objectType`);
    }
    entities[key] = {
      kind,
      objectType,
      ...(typeof property === 'string' ? { property } : {}),
    };
  }
  const conditionsRaw = o['conditions'];
  const mappingsRaw = o['mappings'];
  const conditions = (Array.isArray(conditionsRaw) ? conditionsRaw : []) as Condition[];
  const mappings = (Array.isArray(mappingsRaw) ? mappingsRaw : []) as Mapping[];
  return { name, entities, conditions, mappings };
}
