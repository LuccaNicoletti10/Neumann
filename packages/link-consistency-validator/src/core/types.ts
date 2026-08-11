/**
 * link-consistency-validator — tipos centrais do domínio.
 *
 * Implementa funcionalmente, de forma original, os elementos de dados descritos
 * na patente US 8,930,897 B2 (Palantir/Nassar, "Data Integration Tool"):
 * entidades definidas como objeto ou propriedade de objeto, links entre duas
 * entidades, data items importados de fonte de dados, condições de depuração e
 * resultados expressed/implicit exibidos num "display device" abstrato.
 */

/** Entidade definida como OBJETO ou como PROPRIEDADE de um objeto. */
export type EntityKind = 'object' | 'property';

export interface Entity {
  kind: EntityKind;
  /** Nome simples da entidade (ex.: "Pessoa" ou "nome"). */
  name: string;
  /** Objeto pai, quando a entidade é uma propriedade (ex.: "Pessoa"). */
  parent?: string;
  /** Tipo de dado declarado para propriedades (ex.: "string"). */
  dataType?: string;
}

/** Nome qualificado da entidade: "Pessoa" ou "Pessoa.nome". */
export function entityKey(e: Entity): string {
  return e.kind === 'property' && e.parent ? `${e.parent}.${e.name}` : e.name;
}

/** Link direcionado e predicado entre duas entidades: from --predicate--> to. */
export interface Link {
  from: string;
  predicate: string;
  to: string;
}

/** Data item importado de uma fonte de dados (CSV estruturado ou texto). */
export interface DataItem {
  id: string;
  /** Origem do item (ex.: "csv", "text"). */
  source: string;
  /** Campos estruturados extraídos (colunas do CSV ou grupos nomeados do regex). */
  fields: Record<string, string>;
  /** Texto bruto, quando proveniente de fonte não estruturada. */
  text?: string;
}

/** Condição de depuração: usa um data item importado e verifica um link. */
export interface Condition {
  name: string;
  /** Link que o builder criou e que será conferido contra a ontologia. */
  link: Link;
  /** Identificador do data item importado usado pela condição. */
  dataItemId: string;
  /** Linha do script DSL onde a condição foi declarada. */
  line: number;
}

/** Resultado produzido pela operação de depuração. */
export interface ValidationResult {
  /**
   * EXPRESSED: exibido no display device (condição inválida ou validação final).
   * IMPLICIT: silencioso — condição válida com condições subsequentes.
   */
  kind: 'expressed' | 'implicit';
  message: string;
  conditionIndex: number;
  conditionName: string;
  valid: boolean;
}

/**
 * "Display device" abstrato e injetável: recebe apenas resultados EXPRESSED.
 * Em produção pode ser um console/HTTP; em testes, um coletor em memória.
 */
export interface DisplayDevice {
  display(message: string): void;
}

/** Display device padrão: escreve em um canal de saída injetável. */
export class StreamDisplayDevice implements DisplayDevice {
  constructor(private readonly write: (message: string) => void) {}
  display(message: string): void {
    this.write(message);
  }
}

/** Display device coletor (usado por servidor e testes). */
export class CollectingDisplayDevice implements DisplayDevice {
  readonly messages: string[] = [];
  display(message: string): void {
    this.messages.push(message);
  }
}
