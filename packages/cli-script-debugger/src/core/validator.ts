/**
 * cli-script-debugger — src/core/validator.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: NÚCLEO DE VALIDAÇÃO / DEBUGGING —
 * importa data items de data source estruturada (CSV) ou não estruturada
 * (texto); associa o script à ontologia no modo EAGER (resolvida do config
 * antes do run) ou LAZY (associação tardia DURANTE a operação de debug, com
 * cache); e determina condição inválida com base nos ontology parameters
 * (atribuição inconsistente com a definição da entidade, mapping incompatível
 * e condição sobre data source não mapeado ou de tipo incompatível).
 */

import { findParameter, isAssignmentConsistent } from './ontology.js';
import type { OntologyLoader } from './ontology.js';
import type {
  Condition,
  DataItem,
  Ontology,
  ScriptDefinition,
  Verdict,
  VerdictIssue,
} from './types.js';

/** Modo de associação script ↔ ontologia. */
export type AssociationMode = 'eager' | 'lazy';

export interface ValidatorOptions {
  mode: AssociationMode;
  /** Ontologia já resolvida (associação antecipada/eager). */
  ontology?: Ontology;
  /** Loader injetável: eager chama antes do run; lazy chama no 1º uso durante o debug. */
  loader?: OntologyLoader;
}

/**
 * Validator do transformation script. No modo EAGER a ontologia é resolvida
 * na construção (antes da operação de debug); no modo LAZY ela só é resolvida
 * no primeiro uso dentro do run e fica em cache.
 */
export class Validator {
  private cache: Ontology | undefined;

  constructor(
    private readonly script: ScriptDefinition,
    private readonly options: ValidatorOptions,
  ) {
    if (options.mode === 'eager') {
      this.cache = this.resolveFrom(options);
    }
  }

  private resolveFrom(options: ValidatorOptions): Ontology {
    if (options.ontology !== undefined) return options.ontology;
    if (options.loader !== undefined) return options.loader();
    throw new Error('Validator: ontology ou loader são obrigatórios');
  }

  /** Resolve a ontologia; no modo lazy a associação ocorre aqui, durante o debugging, com cache. */
  private ontology(): Ontology {
    if (this.cache !== undefined) return this.cache;
    this.cache = this.resolveFrom(this.options);
    return this.cache;
  }

  /** Executa a operação de debug sobre os data items importados. */
  run(items: readonly DataItem[]): Verdict {
    const ontology = this.ontology(); // lazy: primeiro uso acontece aqui, durante o debug
    const issues: VerdictIssue[] = [];
    issues.push(...this.checkAssignments(ontology));
    issues.push(...this.checkMappings(ontology, items));
    const conditionResult = this.checkConditions(items);
    issues.push(...conditionResult.issues);
    return {
      valid: issues.length === 0,
      issues,
      stats: {
        items: items.length,
        evaluated: conditionResult.evaluated,
        failed: conditionResult.failed,
      },
    };
  }

  /** Atribuição da ontologia inconsistente com a definição da entidade no script. */
  private checkAssignments(ontology: Ontology): VerdictIssue[] {
    const issues: VerdictIssue[] = [];
    for (const parameter of ontology.parameters) {
      const def = this.script.entities[parameter.entity];
      if (def === undefined) {
        issues.push({
          code: 'UNKNOWN_ENTITY',
          message: `ontology parameter "${parameter.name}" refere entidade "${parameter.entity}" ausente no script`,
          entity: parameter.entity,
          parameter: parameter.name,
        });
        continue;
      }
      if (!isAssignmentConsistent(def, parameter.assignment)) {
        issues.push({
          code: 'INCONSISTENT_ASSIGNMENT',
          message:
            `atribuição da ontologia para "${parameter.name}" ` +
            `(${parameter.assignment.kind} ${parameter.assignment.objectType}` +
            `${parameter.assignment.property !== undefined ? '.' + parameter.assignment.property : ''}) ` +
            `inconsistente com a definição da entidade "${parameter.entity}" no script ` +
            `(${def.kind} ${def.objectType}${def.property !== undefined ? '.' + def.property : ''})`,
          entity: parameter.entity,
          parameter: parameter.name,
        });
      }
    }
    return issues;
  }

  /** Mapping incompatível: entidade/parâmetro desconhecidos, divergência de entidade ou campo sem dados. */
  private checkMappings(ontology: Ontology, items: readonly DataItem[]): VerdictIssue[] {
    const issues: VerdictIssue[] = [];
    for (const mapping of this.script.mappings) {
      if (this.script.entities[mapping.entity] === undefined) {
        issues.push({
          code: 'INVALID_MAPPING',
          message: `mapping usa entidade "${mapping.entity}" ausente no script`,
          entity: mapping.entity,
          parameter: mapping.parameter,
        });
        continue;
      }
      const parameter = findParameter(ontology, mapping.parameter);
      if (parameter === undefined) {
        issues.push({
          code: 'INVALID_MAPPING',
          message: `mapping refere ontology parameter "${mapping.parameter}" inexistente`,
          entity: mapping.entity,
          parameter: mapping.parameter,
        });
        continue;
      }
      if (parameter.entity !== mapping.entity) {
        issues.push({
          code: 'INVALID_MAPPING',
          message:
            `mapping associa o campo "${mapping.dataField}" à entidade "${mapping.entity}", ` +
            `mas o ontology parameter "${mapping.parameter}" pertence à entidade "${parameter.entity}"`,
          entity: mapping.entity,
          parameter: mapping.parameter,
        });
        continue;
      }
      if (!items.some((item) => item.fields[mapping.dataField] !== undefined)) {
        issues.push({
          code: 'INVALID_MAPPING',
          message: `campo "${mapping.dataField}" mapeado para "${mapping.parameter}" não existe nos data items`,
          entity: mapping.entity,
          parameter: mapping.parameter,
        });
      }
    }
    return issues;
  }

  /**
   * Determina condição inválida COM BASE NOS ONTOLOGY PARAMETERS: condição
   * sobre data source não mapeado a nenhum parâmetro, ou avaliação
   * incompatível (ex.: faixa numérica sobre valor não numérico).
   */
  private checkConditions(items: readonly DataItem[]): {
    issues: VerdictIssue[];
    evaluated: number;
    failed: number;
  } {
    const issues: VerdictIssue[] = [];
    let evaluated = 0;
    let failed = 0;
    for (const condition of this.script.conditions) {
      const mapped = this.script.mappings.some((m) => m.dataField === condition.dataSource);
      if (!mapped) {
        issues.push({
          code: 'INVALID_CONDITION',
          message:
            `condição sobre o data source "${condition.dataSource}" é inválida: ` +
            'o campo não está mapeado a nenhum ontology parameter',
        });
        continue;
      }
      const errors: string[] = [];
      for (const item of items) {
        evaluated += 1;
        const result = evaluateCondition(condition, item);
        if (!result.ok) {
          failed += 1;
          if (result.error !== undefined) errors.push(`linha ${item.line}: ${result.error}`);
        }
      }
      if (errors.length > 0) {
        issues.push({
          code: 'INVALID_CONDITION',
          message:
            `condição "${condition.type}" sobre "${condition.dataSource}" é inválida ` +
            `diante dos ontology parameters: ${errors[0] ?? 'erro de avaliação'}`,
        });
      }
    }
    return { issues, evaluated, failed };
  }
}

/** Avalia uma condição sobre um data item. */
export function evaluateCondition(
  condition: Condition,
  item: DataItem,
): { ok: boolean; error?: string } {
  const value = item.fields[condition.dataSource];
  switch (condition.type) {
    case 'fieldPresent':
      return { ok: value !== undefined && value !== '' };
    case 'equals':
      if (value === undefined) return { ok: false, error: 'campo ausente no data item' };
      return { ok: value === condition.expected };
    case 'contains':
      if (value === undefined) return { ok: false, error: 'campo ausente no data item' };
      return { ok: value.includes(condition.expected ?? '') };
    case 'numericRange': {
      if (value === undefined) return { ok: false, error: 'campo ausente no data item' };
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `valor não numérico: "${value}"` };
      const min = condition.min ?? Number.NEGATIVE_INFINITY;
      const max = condition.max ?? Number.POSITIVE_INFINITY;
      return { ok: n >= min && n <= max };
    }
  }
}

/** Importa data items de uma data source ESTRUTURADA (CSV com cabeçalho). */
export function importCsv(text: string): DataItem[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const headerLine = lines[0];
  if (headerLine === undefined) return [];
  const headers = headerLine.split(',').map((h) => h.trim());
  const items: DataItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const cells = line.split(',').map((c) => c.trim());
    const fields: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header !== undefined) fields[header] = cells[j] ?? '';
    }
    items.push({ source: 'csv', id: `csv-${i}`, line: i + 1, fields });
  }
  return items;
}

/** Importa data items de uma data source NÃO ESTRUTURADA (texto, um item por linha). */
export function importText(text: string): DataItem[] {
  const items: DataItem[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const content = lines[i];
    if (content === undefined || content.trim() === '') continue;
    items.push({
      source: 'text',
      id: `txt-${i + 1}`,
      line: i + 1,
      fields: { text: content.trim() },
    });
  }
  return items;
}
