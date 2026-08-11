/**
 * validation-result-notifier — src/core/validation.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: núcleo de validação proativa — builder do transformation
 * script (entidade como OBJETO ou PROPRIEDADE), parâmetros ontológicos que também
 * atribuem entidade, importação de data items de fontes estruturadas (CSV/JSON) e
 * não estruturadas (texto), e operação de debugging que determina condição inválida
 * por (a) atribuição inconsistente com a definição ou (b) mapping incompatível.
 */

import type {
  Assignment,
  Condition,
  DataItem,
  DataSourceSpec,
  EntityDefinition,
  InvalidReason,
  Mapping,
  OntologyParameter,
  TransformationScript,
  ValidationVerdict,
} from './types.js';

/** Builder fluente do transformation script. */
export class TransformationScriptBuilder {
  private readonly script: TransformationScript;

  constructor(name: string) {
    this.script = { name, entities: [], ontologyParameters: [], conditions: [] };
  }

  /** Define a entidade como OBJETO. */
  defineEntityAsObject(entity: string): this {
    this.script.entities.push({ entity, kind: 'object' });
    return this;
  }

  /** Define a entidade como PROPRIEDADE de um objeto. */
  defineEntityAsProperty(entity: string, parentObject: string): this {
    this.script.entities.push({ entity, kind: 'property', parentObject });
    return this;
  }

  /** Associa um parâmetro ontológico (que também atribui entidade como objeto/propriedade). */
  addOntologyParameter(parameter: OntologyParameter): this {
    this.script.ontologyParameters.push(parameter);
    return this;
  }

  /** Adiciona uma condição baseada no data source. */
  addCondition(condition: Condition): this {
    this.script.conditions.push(condition);
    return this;
  }

  build(): TransformationScript {
    return {
      name: this.script.name,
      entities: [...this.script.entities],
      ontologyParameters: [...this.script.ontologyParameters],
      conditions: [...this.script.conditions],
    };
  }
}

export function createTransformationScript(name: string): TransformationScriptBuilder {
  return new TransformationScriptBuilder(name);
}

/** Divide linhas descartando vazias — determinístico. */
function linesOf(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Importação de fonte ESTRUTURADA CSV: cabeçalho + registros. */
function importCsv(content: string): DataItem[] {
  const lines = linesOf(content);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  const items: DataItem[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = (lines[i] ?? '').split(',').map((c) => c.trim());
    const fields: Record<string, string> = {};
    header.forEach((name, idx) => {
      fields[name] = cells[idx] ?? '';
    });
    items.push({
      id: fields['id'] !== undefined && fields['id'] !== '' ? fields['id'] : `row-${i}`,
      type: 'record',
      value: lines[i] ?? '',
      fields,
    });
  }
  return items;
}

/** Importação de fonte ESTRUTURADA JSON: array de objetos. */
function importJson(content: string): DataItem[] {
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('fonte JSON deve ser um array de objetos');
  }
  return parsed.map((entry, i) => {
    const obj = (entry ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      fields[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    const id = typeof obj['id'] === 'string' && obj['id'] !== '' ? obj['id'] : `item-${i}`;
    const type = typeof obj['type'] === 'string' && obj['type'] !== '' ? obj['type'] : 'record';
    return { id, type, value: JSON.stringify(entry), fields };
  });
}

/** Importação de fonte NÃO ESTRUTURADA: cada linha vira um data item textual. */
function importText(content: string): DataItem[] {
  return linesOf(content).map((line, i) => ({
    id: `line-${i}`,
    type: 'text',
    value: line,
  }));
}

/** Importa data items do data source conforme o formato declarado. */
export function importDataItems(source: DataSourceSpec): DataItem[] {
  switch (source.format) {
    case 'csv':
      return importCsv(source.content);
    case 'json':
      return importJson(source.content);
    case 'text':
      return importText(source.content);
  }
}

/** Atribuição consistente com a definição (mesma natureza objeto/propriedade e mesmo pai). */
export function assignmentMatchesDefinition(
  assignment: Assignment,
  definition: EntityDefinition,
): boolean {
  if (assignment.entity !== definition.entity) return false;
  if (assignment.kind !== definition.kind) return false;
  if (definition.kind === 'property') {
    return (assignment.parentObject ?? '') === (definition.parentObject ?? '');
  }
  return true;
}

/**
 * Operação de debugging sobre UMA condição: determina se é inválida por
 * atribuição inconsistente com a definição ou mapping incompatível.
 */
export function validateCondition(
  condition: Condition,
  script: TransformationScript,
  dataItems: DataItem[],
): ValidationVerdict {
  const reasons: InvalidReason[] = [];

  // 1) A definição pode vir de um parâmetro ontológico (que também atribui a
  //    entidade) ou das definições do próprio script; parâmetro tem precedência.
  const fromParameter = script.ontologyParameters.find(
    (p) => p.defines.entity === condition.assignment.entity,
  );
  const fromScript = script.entities.find((e) => e.entity === condition.assignment.entity);
  const definition = fromParameter?.defines ?? fromScript;

  if (!definition) {
    reasons.push({
      code: 'entity-inconsistent',
      detail: `entidade '${condition.assignment.entity}' não possui definição no script nem em parâmetro ontológico`,
    });
  } else if (!assignmentMatchesDefinition(condition.assignment, definition)) {
    const expected =
      definition.kind === 'property'
        ? `propriedade de '${definition.parentObject ?? ''}'`
        : 'objeto';
    const actual =
      condition.assignment.kind === 'property'
        ? `propriedade de '${condition.assignment.parentObject ?? ''}'`
        : 'objeto';
    reasons.push({
      code: 'entity-inconsistent',
      detail: `entidade '${condition.assignment.entity}' atribuída como ${actual}, mas definida como ${expected}`,
    });
  }

  // 2) Mappings de data items a parâmetros ontológicos.
  for (const mapping of condition.mappings) {
    checkMapping(mapping, script, dataItems, reasons);
  }

  // 3) Requisitos da condição sobre o data source.
  const requirement = condition.sourceRequirement;
  if (requirement?.field !== undefined) {
    const mapped = condition.mappings
      .map((m) => dataItems.find((item) => item.id === m.dataItemId))
      .filter((item): item is DataItem => item !== undefined);
    const missing = mapped.filter((item) => item.fields?.[requirement.field ?? ''] === undefined);
    if (missing.length > 0) {
      reasons.push({
        code: 'source-requirement-unmet',
        detail: `campo '${requirement.field}' ausente nos data items: ${missing
          .map((item) => item.id)
          .join(', ')}`,
      });
    }
  }
  if (requirement?.type !== undefined) {
    const exists = dataItems.some((item) => item.type === requirement.type);
    if (!exists) {
      reasons.push({
        code: 'source-requirement-unmet',
        detail: `nenhum data item do tipo '${requirement.type}' na fonte importada`,
      });
    }
  }

  return { conditionId: condition.id, valid: reasons.length === 0, reasons };
}

function checkMapping(
  mapping: Mapping,
  script: TransformationScript,
  dataItems: DataItem[],
  reasons: InvalidReason[],
): void {
  const parameter = script.ontologyParameters.find((p) => p.name === mapping.parameterName);
  if (!parameter) {
    reasons.push({
      code: 'mapping-incompatible',
      detail: `parâmetro ontológico '${mapping.parameterName}' não associado ao script`,
    });
    return;
  }
  const item = dataItems.find((candidate) => candidate.id === mapping.dataItemId);
  if (!item) {
    reasons.push({
      code: 'data-item-missing',
      detail: `data item '${mapping.dataItemId}' não importado do data source`,
    });
    return;
  }
  if (parameter.acceptedTypes !== undefined && !parameter.acceptedTypes.includes(item.type)) {
    reasons.push({
      code: 'mapping-incompatible',
      detail: `data item '${item.id}' do tipo '${item.type}' incompatível com o parâmetro '${parameter.name}' (aceita: ${parameter.acceptedTypes.join(', ')})`,
    });
  }
}

/** Operação de debugging completa: valida todas as condições do script, em ordem. */
export function runDebugOperation(
  script: TransformationScript,
  dataItems: DataItem[],
): ValidationVerdict[] {
  return script.conditions.map((condition) => validateCondition(condition, script, dataItems));
}
