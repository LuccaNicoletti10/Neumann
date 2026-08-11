/**
 * cli-script-debugger — src/core/ontology.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: ONTOLOGY FILE — ontology parameters
 * que atribuem entidades como OBJETO ou PROPRIEDADE de objeto, parsing do
 * arquivo JSON de ontologia e consulta de consistência entre a atribuição da
 * ontologia e a definição da entidade no script.
 */

import type {
  EntityAssignment,
  EntityDef,
  Ontology,
  OntologyParameter,
} from './types.js';

/**
 * Loader injetável da ontologia. Permite a associação tardia (lazy) durante o
 * debugging, com cache e contagem de cargas nos testes.
 */
export type OntologyLoader = () => Ontology;

/** Faz o parsing e valida um ontology file JSON. */
export function parseOntology(json: string): Ontology {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('ontologia inválida: esperado objeto JSON');
  }
  const o = raw as Record<string, unknown>;
  const name = o['name'];
  if (typeof name !== 'string' || name === '') {
    throw new Error('ontologia inválida: campo "name" obrigatório');
  }
  const paramsRaw = o['parameters'];
  if (!Array.isArray(paramsRaw)) {
    throw new Error('ontologia inválida: campo "parameters" deve ser array');
  }
  const parameters: OntologyParameter[] = paramsRaw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`ontologia inválida: parâmetro #${index} deve ser objeto`);
    }
    const p = entry as Record<string, unknown>;
    const pName = p['name'];
    const entity = p['entity'];
    const assignmentRaw = p['assignment'];
    if (typeof pName !== 'string' || pName === '') {
      throw new Error(`ontologia inválida: parâmetro #${index} sem "name"`);
    }
    if (typeof entity !== 'string' || entity === '') {
      throw new Error(`ontologia inválida: parâmetro "${pName}" sem "entity"`);
    }
    if (typeof assignmentRaw !== 'object' || assignmentRaw === null) {
      throw new Error(`ontologia inválida: parâmetro "${pName}" sem "assignment"`);
    }
    const a = assignmentRaw as Record<string, unknown>;
    const kind = a['kind'];
    const objectType = a['objectType'];
    const property = a['property'];
    if (kind !== 'object' && kind !== 'property') {
      throw new Error(`ontologia inválida: assignment de "${pName}" com kind inválido`);
    }
    if (typeof objectType !== 'string' || objectType === '') {
      throw new Error(`ontologia inválida: assignment de "${pName}" sem objectType`);
    }
    return {
      name: pName,
      entity,
      assignment: {
        kind,
        objectType,
        ...(typeof property === 'string' ? { property } : {}),
      },
    };
  });
  return { name, parameters };
}

/** Consulta um ontology parameter pelo nome. */
export function findParameter(ontology: Ontology, name: string): OntologyParameter | undefined {
  return ontology.parameters.find((p) => p.name === name);
}

/**
 * Verifica a consistência entre a DEFINIÇÃO da entidade no script e a
 * ATRIBUIÇÃO feita pela ontologia (kind, objectType e, para propriedade, o
 * nome da propriedade precisam coincidir).
 */
export function isAssignmentConsistent(def: EntityDef, assignment: EntityAssignment): boolean {
  if (def.kind !== assignment.kind) return false;
  if (def.objectType !== assignment.objectType) return false;
  if (def.kind === 'property') return def.property === assignment.property;
  return true;
}
