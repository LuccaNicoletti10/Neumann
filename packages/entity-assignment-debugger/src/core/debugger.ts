/**
 * entity-assignment-debugger — operação de depuração (debugging operation).
 *
 * Implementa funcionalmente o componente da patente US 9,984,152 B2 relativo à
 * OPERAÇÃO DE DEPURAÇÃO do transformation script com condições que usam data
 * items importados. Para cada condição, determina-se se ela é VÁLIDA:
 *   - válida quando a ATRIBUIÇÃO da entidade na ontologia é CONSISTENTE com a
 *     DEFINIÇÃO da entidade no builder (e os links atribuídos são consistentes
 *     com os links criados, e os mappings resolvem para parâmetros existentes
 *     e compatíveis);
 *   - inválida caso contrário.
 *
 * Fluxo exato de indicação de resultados:
 *   (a) condição INVÁLIDA  → resultado EXPRESSED no display device (falha);
 *   (b) condição VÁLIDA + EXISTE condição subsequente → resultado IMPLICIT
 *       (silencioso, a depuração prossegue);
 *   (c) condição VÁLIDA + NÃO há subsequentes → EXPRESSED no display:
 *       "transformation script has been validated".
 */

import type { DataSource } from './data-source.js';
import type { Ontology } from './ontology.js';
import type {
  Condition,
  DataItem,
  DebugOutcome,
  DebugReport,
  TransformationScript,
} from './types.js';

/** Mensagem exibida quando a última condição é válida e não há subsequentes. */
export const VALIDATED_MESSAGE = 'transformation script has been validated';

/**
 * Display device injetável: recebe APENAS os resultados EXPRESSED
 * (inválidos ou a validação final). Resultados IMPLICIT não chegam aqui.
 */
export interface DisplayDevice {
  express(outcome: DebugOutcome): void;
}

/** Display device em memória, capturável em testes e reutilizável (CLI/servidor). */
export class MemoryDisplayDevice implements DisplayDevice {
  readonly outcomes: DebugOutcome[] = [];
  readonly messages: string[] = [];

  express(outcome: DebugOutcome): void {
    this.outcomes.push(outcome);
    this.messages.push(outcome.message);
  }
}

/** Executa a operação de depuração sobre um transformation script. */
export class ScriptDebugger {
  constructor(private readonly display: DisplayDevice) {}

  /**
   * Importa os data items da fonte, resolve os mappings para parâmetros da
   * ontologia e avalia cada condição em ordem, emitindo a sequência de
   * resultados conforme o fluxo (a)/(b)/(c) descrito no cabeçalho.
   */
  run(script: TransformationScript, ontology: Ontology, source: DataSource): DebugReport {
    const items = source.importData();
    const itemsById = new Map<string, DataItem>(items.map((it) => [it.id, it]));
    const outcomes: DebugOutcome[] = [];

    for (let i = 0; i < script.conditions.length; i++) {
      const condition = script.conditions[i] as Condition;
      const reasons = this.evaluateCondition(condition, script, ontology, itemsById);

      if (reasons.length > 0) {
        // (a) condição inválida → EXPRESSED no display device; depuração falha.
        const outcome: DebugOutcome = {
          conditionId: condition.id,
          kind: 'invalid',
          valid: false,
          expressed: true,
          message: `condition "${condition.id}" is invalid: ${reasons.join('; ')}`,
          reasons,
        };
        this.display.express(outcome);
        outcomes.push(outcome);
        return { success: false, outcomes };
      }

      const hasSubsequent = i < script.conditions.length - 1;
      if (hasSubsequent) {
        // (b) condição válida + existe subsequente → IMPLICIT (silencioso).
        outcomes.push({
          conditionId: condition.id,
          kind: 'implicit',
          valid: true,
          expressed: false,
          message: '',
          reasons: [],
        });
      } else {
        // (c) condição válida + sem subsequentes → EXPRESSED "validated".
        const outcome: DebugOutcome = {
          conditionId: condition.id,
          kind: 'validated',
          valid: true,
          expressed: true,
          message: VALIDATED_MESSAGE,
          reasons: [],
        };
        this.display.express(outcome);
        outcomes.push(outcome);
      }
    }

    return { success: true, outcomes };
  }

  /**
   * Avalia uma condição: consistência atribuição×definição da entidade,
   * consistência dos links usados e validade dos mappings associados.
   * Retorna a lista de razões de invalidade (vazia = condição válida).
   */
  private evaluateCondition(
    condition: Condition,
    script: TransformationScript,
    ontology: Ontology,
    itemsById: Map<string, DataItem>,
  ): string[] {
    const reasons: string[] = [];

    // 1. Consistência ATRIBUIÇÃO (ontologia) × DEFINIÇÃO (builder) da entidade.
    const def = script.definitions.find((d) => d.name === condition.entity);
    if (!def) {
      reasons.push(`condição "${condition.id}" usa a entidade "${condition.entity}", que não é definida pelo builder`);
    } else {
      reasons.push(...ontology.isConsistentWith(def).reasons);
    }

    // 2. Consistência dos links usados pela condição.
    for (const linkName of condition.links ?? []) {
      const link = script.links.find((l) => l.name === linkName);
      if (!link) {
        reasons.push(`condição "${condition.id}" usa o link "${linkName}", que não é criado pelo builder`);
      } else {
        reasons.push(...ontology.isLinkConsistent(link).reasons);
      }
    }

    // 3. Resolução dos mappings para parâmetros da ontologia.
    for (const mapping of script.mappings) {
      const tiedToCondition =
        mapping.entity === condition.entity ||
        (condition.dataItemId !== undefined && mapping.dataItemId === condition.dataItemId);
      if (!tiedToCondition) continue;
      reasons.push(...this.validateMapping(mapping.dataItemField, mapping.entity, mapping.parameter, script, ontology));

      // Porção do data item: se a condição usa um data item, o campo mapeado deve existir nele.
      if (condition.dataItemId !== undefined) {
        const item = itemsById.get(condition.dataItemId);
        if (!item) {
          reasons.push(`condição "${condition.id}" usa o data item "${condition.dataItemId}", que não foi importado`);
        } else if (!(mapping.dataItemField in item.fields)) {
          reasons.push(
            `mapping do campo "${mapping.dataItemField}": campo ausente no data item "${condition.dataItemId}"`,
          );
        }
      }
    }

    return reasons;
  }

  /**
   * Resolve um mapping data item → parâmetro da ontologia:
   * inválido se o parâmetro não existe na atribuição da entidade ou se o tipo
   * atribuído é incompatível com o tipo definido pelo builder.
   */
  private validateMapping(
    dataItemField: string,
    entity: string,
    parameter: string,
    script: TransformationScript,
    ontology: Ontology,
  ): string[] {
    const reasons: string[] = [];
    const assignment = ontology.getAssignment(entity);
    if (!assignment) {
      reasons.push(`mapping do campo "${dataItemField}": entidade "${entity}" não é atribuída pela ontologia`);
      return reasons;
    }
    if (assignment.kind !== 'object') {
      reasons.push(
        `mapping do campo "${dataItemField}" para "${entity}.${parameter}": ` +
          `a ontologia atribui "${entity}" como propriedade, não como objeto com parâmetros`,
      );
      return reasons;
    }
    const assignedType = assignment.properties?.[parameter];
    if (assignedType === undefined) {
      reasons.push(
        `mapping do campo "${dataItemField}" para "${entity}.${parameter}": ` +
          `parâmetro inexistente na atribuição da ontologia`,
      );
      return reasons;
    }
    // Incompatibilidade: tipo atribuído na ontologia diverge do tipo definido no builder.
    const def = script.definitions.find((d) => d.name === entity && d.kind === 'object');
    const definedType = def?.properties?.[parameter];
    if (definedType !== undefined && definedType !== assignedType) {
      reasons.push(
        `mapping do campo "${dataItemField}" para "${entity}.${parameter}": ` +
          `tipo incompatível — ontologia atribui "${assignedType}", builder define "${definedType}"`,
      );
    }
    return reasons;
  }
}
