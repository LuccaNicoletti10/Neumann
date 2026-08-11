/**
 * link-consistency-validator — parâmetros de ontologia.
 *
 * Implementa funcionalmente os "ontology parameters" da patente US 8,930,897 B2:
 * um modelo de ontologia que ATRIBUI entidades como objeto ou propriedade e
 * ATRIBUI links entre duas entidades (ex.: Pessoa -> Empresa com predicado
 * "trabalha_em"). Carregável a partir de JSON.
 */
import type { Entity, Link } from './types.js';

export class OntologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OntologyError';
  }
}

/** Formato JSON aceito para os parâmetros de ontologia. */
export interface OntologyJson {
  entities?: Array<{ kind: 'object' | 'property'; name: string; parent?: string; dataType?: string }>;
  links?: Array<{ from: string; predicate: string; to: string }>;
}

export class Ontology {
  private readonly entityAssignments = new Map<string, Entity>();
  private readonly assignedLinks: Link[] = [];

  private constructor(model: OntologyJson) {
    for (const e of model.entities ?? []) {
      if (e.kind !== 'object' && e.kind !== 'property') {
        throw new OntologyError(`kind de entidade inválido na ontologia: "${String(e.kind)}"`);
      }
      const key = e.kind === 'property' && e.parent ? `${e.parent}.${e.name}` : e.name;
      const entity: Entity = { kind: e.kind, name: e.name, ...(e.parent !== undefined ? { parent: e.parent } : {}), ...(e.dataType !== undefined ? { dataType: e.dataType } : {}) };
      this.entityAssignments.set(key, entity);
      // Também indexa pelo nome simples (links referenciam nomes não qualificados).
      if (!this.entityAssignments.has(e.name)) {
        this.entityAssignments.set(e.name, entity);
      }
    }
    for (const l of model.links ?? []) {
      if (!l.from || !l.predicate || !l.to) {
        throw new OntologyError('link atribuído na ontologia exige from, predicate e to');
      }
      this.assignedLinks.push({ from: l.from, predicate: l.predicate, to: l.to });
    }
  }

  /** Carrega os parâmetros de ontologia de uma string JSON ou objeto já parseado. */
  static fromJson(input: string | OntologyJson): Ontology {
    let model: unknown;
    try {
      model = typeof input === 'string' ? JSON.parse(input) : input;
    } catch (err) {
      throw new OntologyError(`JSON de ontologia inválido: ${(err as Error).message}`);
    }
    if (typeof model !== 'object' || model === null || Array.isArray(model)) {
      throw new OntologyError('modelo de ontologia deve ser um objeto JSON');
    }
    return new Ontology(model as OntologyJson);
  }

  /** Atribuição (objeto/propriedade) que a ontologia declara para a entidade. */
  entityAssignment(name: string): Entity | undefined {
    return this.entityAssignments.get(name);
  }

  /** Todos os links atribuídos pela ontologia. */
  get links(): Link[] {
    return [...this.assignedLinks];
  }

  /** Links atribuídos entre as duas entidades, em qualquer direção. */
  assignedLinksBetween(a: string, b: string): Link[] {
    return this.assignedLinks.filter(
      (l) => (l.from === a && l.to === b) || (l.from === b && l.to === a),
    );
  }

  /** Link atribuído que casa exatamente from/predicate/to. */
  assignedLink(link: Link): Link | undefined {
    return this.assignedLinks.find(
      (l) => l.from === link.from && l.predicate === link.predicate && l.to === link.to,
    );
  }
}
