/**
 * entity-assignment-debugger — ontologia de atribuições.
 *
 * Implementa funcionalmente o componente da patente US 9,984,152 B2 relativo à
 * ONTOLOGIA que ATRIBUI cada entidade como OBJETO ou como PROPRIEDADE de um
 * objeto (com tipos) e que atribui links entre entidades. Fornece a consulta de
 * consistência usada pela operação de depuração: a ATRIBUIÇÃO (ontologia) é
 * comparada com a DEFINIÇÃO (builder) — se divergirem, a condição é inválida.
 */

import type { EntityAssignment, EntityDef, Link } from './types.js';

/** Forma serializável da ontologia (JSON). */
export interface OntologyJSON {
  assignments: EntityAssignment[];
  links?: Link[];
}

/** Resultado de uma consulta de consistência. */
export interface ConsistencyResult {
  consistent: boolean;
  reasons: string[];
}

/**
 * Repositório de ATRIBUIÇÕES de entidades e de links, carregável de JSON.
 */
export class Ontology {
  private readonly assignments = new Map<string, EntityAssignment>();
  private readonly linkMap = new Map<string, Link>();

  constructor(assignments: EntityAssignment[] = [], links: Link[] = []) {
    for (const a of assignments) this.assignments.set(a.name, { ...a });
    for (const l of links) this.linkMap.set(l.name, { ...l });
  }

  /** Carrega a ontologia a partir de JSON (string ou objeto já parseado). */
  static fromJSON(input: string | OntologyJSON): Ontology {
    const parsed: OntologyJSON = typeof input === 'string' ? (JSON.parse(input) as OntologyJSON) : input;
    if (!parsed || !Array.isArray(parsed.assignments)) {
      throw new Error('ontologia inválida: esperado objeto com "assignments" (array)');
    }
    return new Ontology(parsed.assignments, parsed.links ?? []);
  }

  /** Consulta a atribuição de uma entidade pelo nome. */
  getAssignment(name: string): EntityAssignment | undefined {
    return this.assignments.get(name);
  }

  /** Consulta um link atribuído pelo nome. */
  getLink(name: string): Link | undefined {
    return this.linkMap.get(name);
  }

  /** Lista os nomes de todas as entidades atribuídas. */
  assignedEntities(): string[] {
    return [...this.assignments.keys()];
  }

  /**
   * Verifica se a ATRIBUIÇÃO da entidade na ontologia é CONSISTENTE com a
   * DEFINIÇÃO da entidade no builder. Inconsistente quando, por exemplo, a
   * ontologia atribui "Endereco" como objeto mas o builder o define como
   * propriedade de "Pessoa" (ou vice-versa), ou quando dono/tipo divergem.
   */
  isConsistentWith(def: EntityDef): ConsistencyResult {
    const reasons: string[] = [];
    const assignment = this.assignments.get(def.name);
    if (!assignment) {
      reasons.push(`entidade "${def.name}" não é atribuída pela ontologia`);
      return { consistent: false, reasons };
    }
    if (assignment.kind !== def.kind) {
      reasons.push(
        `entidade "${def.name}": ontologia atribui como ${assignment.kind}, ` +
          `mas o builder define como ${def.kind}` +
          (def.kind === 'property' ? ` de "${def.owner ?? '?'}"` : ''),
      );
      return { consistent: false, reasons };
    }
    if (def.kind === 'property') {
      if (assignment.owner !== def.owner) {
        reasons.push(
          `propriedade "${def.name}": ontologia atribui dono "${assignment.owner ?? '?'}", ` +
            `builder define dono "${def.owner ?? '?'}"`,
        );
      }
      if (def.valueType !== undefined && assignment.valueType !== def.valueType) {
        reasons.push(
          `propriedade "${def.name}": ontologia atribui tipo "${assignment.valueType ?? '?'}", ` +
            `builder define tipo "${def.valueType}"`,
        );
      }
    } else if (def.properties) {
      const assignedProps = assignment.properties ?? {};
      for (const [prop, type] of Object.entries(def.properties)) {
        const assignedType = assignedProps[prop];
        if (assignedType !== undefined && assignedType !== type) {
          reasons.push(
            `objeto "${def.name}": propriedade "${prop}" atribuída com tipo "${assignedType}", ` +
              `builder define tipo "${type}"`,
          );
        }
      }
    }
    return { consistent: reasons.length === 0, reasons };
  }

  /**
   * Verifica se o link ATRIBUÍDO na ontologia é consistente com o link CRIADO
   * no builder (mesmo nome, mesmas extremidades).
   */
  isLinkConsistent(link: Link): ConsistencyResult {
    const assigned = this.linkMap.get(link.name);
    if (!assigned) {
      return {
        consistent: false,
        reasons: [`link "${link.name}" criado no builder não é atribuído pela ontologia`],
      };
    }
    const reasons: string[] = [];
    if (assigned.from !== link.from || assigned.to !== link.to) {
      reasons.push(
        `link "${link.name}": ontologia atribui ${assigned.from}→${assigned.to}, ` +
          `builder cria ${link.from}→${link.to}`,
      );
    }
    return { consistent: reasons.length === 0, reasons };
  }
}
