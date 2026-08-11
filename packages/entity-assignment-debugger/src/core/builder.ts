/**
 * entity-assignment-debugger — builder fluente do transformation script.
 *
 * Implementa funcionalmente o componente da patente US 9,984,152 B2 relativo ao
 * BUILDER usado pelo transformation script para DEFINIR cada entidade como objeto
 * ou como propriedade de objeto e para CRIAR LINKS entre duas entidades. Aqui o
 * builder é uma API fluente em TypeScript (não um DSL textual), mas cumpre o
 * mesmo papel funcional: produzir as definições de entidades, os links, os
 * mappings e as condições que serão confrontados com a ontologia na depuração.
 */

import type {
  Condition,
  EntityDef,
  Link,
  Mapping,
  TransformationScript,
} from './types.js';

/** Opções para definir uma entidade como PROPRIEDADE de um objeto. */
export interface DefinePropertyOptions {
  /** Nome do objeto dono da propriedade. */
  owner: string;
  /** Tipo do valor da propriedade (ex.: 'string', 'number'). */
  valueType: string;
}

/**
 * API fluente para construir um TransformationScript.
 *
 * Exemplo:
 *   const script = new TransformationBuilder('exemplo')
 *     .defineObject('Pessoa', { nome: 'string' })
 *     .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
 *     .createLink('resideEm', 'Pessoa', 'Cidade')
 *     .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome' })
 *     .addCondition({ id: 'c1', entity: 'Endereco', dataItemId: 'row-1' })
 *     .build();
 */
export class TransformationBuilder {
  private readonly defs = new Map<string, EntityDef>();
  private readonly linkMap = new Map<string, Link>();
  private readonly mappingList: Mapping[] = [];
  private readonly conditionList: Condition[] = [];

  constructor(private readonly scriptName: string) {}

  /** DEFINE uma entidade como OBJETO, com suas propriedades (nome → tipo). */
  defineObject(name: string, properties: Record<string, string> = {}): this {
    this.defs.set(name, { kind: 'object', name, properties: { ...properties } });
    return this;
  }

  /** DEFINE uma entidade como PROPRIEDADE de um objeto (com tipo). */
  defineProperty(name: string, options: DefinePropertyOptions): this {
    this.defs.set(name, {
      kind: 'property',
      name,
      owner: options.owner,
      valueType: options.valueType,
    });
    return this;
  }

  /** CRIA um link entre duas entidades. */
  createLink(name: string, from: string, to: string): this {
    this.linkMap.set(name, { name, from, to });
    return this;
  }

  /** Adiciona um mapping de (porção de) data item para parâmetro da ontologia. */
  addMapping(mapping: Mapping): this {
    this.mappingList.push({ ...mapping });
    return this;
  }

  /** Adiciona uma condição que usa um data item importado. */
  addCondition(condition: Condition): this {
    this.conditionList.push({ ...condition });
    return this;
  }

  /** Materializa o transformation script (cópias defensivas, imutável na prática). */
  build(): TransformationScript {
    return {
      name: this.scriptName,
      definitions: [...this.defs.values()].map((d) => ({
        ...d,
        properties: d.properties ? { ...d.properties } : undefined,
      })),
      links: [...this.linkMap.values()].map((l) => ({ ...l })),
      mappings: this.mappingList.map((m) => ({ ...m })),
      conditions: this.conditionList.map((c) => ({
        ...c,
        links: c.links ? [...c.links] : undefined,
      })),
    };
  }
}
