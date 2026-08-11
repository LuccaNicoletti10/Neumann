/**
 * link-consistency-validator — operação de depuração do script de transformação.
 *
 * Implementa funcionalmente a "debugging operation" da patente US 8,930,897 B2:
 * inicia uma depuração sobre o script que tem pelo menos uma condição; cada
 * condição usa um data item importado e é INVÁLIDA quando o link ATRIBUÍDO nos
 * parâmetros de ontologia é INCONSISTENTE com o link CRIADO no builder
 * (direção invertida ou predicado divergente), ou quando a atribuição da
 * entidade na ontologia (objeto vs propriedade) é inconsistente com a definição
 * da entidade no builder.
 *
 * Fluxo de resultados: condição inválida → EXPRESSED (mensagem no display
 * device); condição válida com condições subsequentes → IMPLICIT (silencioso);
 * condição válida sem subsequentes → EXPRESSED "transformation script has been
 * validated".
 */
import type { ScriptBuilder } from './builder.js';
import type { Ontology } from './ontology.js';
import type { Condition, DataItem, DisplayDevice, ValidationResult } from './types.js';

export const VALIDATED_MESSAGE = 'transformation script has been validated';

export class ValidatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidatorError';
  }
}

/** Razões de inconsistência encontradas para uma condição (vazio = válida). */
export function findInconsistencies(
  builder: ScriptBuilder,
  ontology: Ontology,
  condition: Condition,
  dataItems: DataItem[],
): string[] {
  const problems: string[] = [];

  const item = dataItems.find((d) => d.id === condition.dataItemId);
  if (!item) {
    problems.push(`data item "${condition.dataItemId}" não foi importado da fonte de dados`);
  }

  // Consistência de atribuição de entidade (objeto vs propriedade).
  for (const endpoint of [condition.link.from, condition.link.to]) {
    const defined = builder.entity(endpoint);
    if (!defined) {
      problems.push(`entidade "${endpoint}" não está definida no builder`);
      continue;
    }
    const assigned = ontology.entityAssignment(endpoint);
    if (assigned && assigned.kind !== defined.kind) {
      problems.push(
        `atribuição da entidade "${endpoint}" na ontologia ("${assigned.kind}") é inconsistente com a definição no builder ("${defined.kind}")`,
      );
    }
  }

  // Consistência de link: criado no builder vs atribuído na ontologia.
  const created = builder.createdLink(condition.link);
  if (!created) {
    problems.push(
      `link ${condition.link.from} --${condition.link.predicate}--> ${condition.link.to} não foi criado no builder`,
    );
  } else {
    const assigned = ontology.assignedLink(created);
    if (!assigned) {
      const between = ontology.assignedLinksBetween(created.from, created.to);
      if (between.length === 0) {
        problems.push(
          `ontologia não atribui link entre "${created.from}" e "${created.to}" para o link criado no builder`,
        );
      } else {
        const desc = between.map((l) => `${l.from} --${l.predicate}--> ${l.to}`).join(', ');
        problems.push(
          `link atribuído na ontologia (${desc}) é inconsistente com o link criado no builder (${created.from} --${created.predicate}--> ${created.to}): direção invertida ou predicado divergente`,
        );
      }
    }
  }
  return problems;
}

export class ScriptValidator {
  constructor(
    private readonly ontology: Ontology,
    private readonly display: DisplayDevice,
  ) {}

  /**
   * Inicia a operação de depuração sobre o script, iterando suas condições.
   * Retorna a sequência de resultados expressed/implicit; a depuração para na
   * primeira condição inválida (resultado EXPRESSED com a inconsistência).
   */
  debug(builder: ScriptBuilder, dataItems: DataItem[]): ValidationResult[] {
    if (builder.conditions.length === 0) {
      throw new ValidatorError('a operação de depuração exige pelo menos uma condição no script');
    }
    const results: ValidationResult[] = [];
    for (let i = 0; i < builder.conditions.length; i++) {
      const condition = builder.conditions[i] as Condition;
      const problems = findInconsistencies(builder, this.ontology, condition, dataItems);
      if (problems.length > 0) {
        const result: ValidationResult = {
          kind: 'expressed',
          valid: false,
          conditionIndex: i,
          conditionName: condition.name,
          message: `condição "${condition.name}" (linha ${condition.line}) não é válida: ${problems.join('; ')}`,
        };
        this.display.display(result.message);
        results.push(result);
        break; // condição inválida: resultado EXPRESSED e fim da depuração
      }
      if (i < builder.conditions.length - 1) {
        // Válida com condições subsequentes: resultado IMPLICIT (silencioso).
        results.push({
          kind: 'implicit',
          valid: true,
          conditionIndex: i,
          conditionName: condition.name,
          message: `condição "${condition.name}" válida; prosseguindo para a próxima condição`,
        });
      } else {
        // Válida e última: EXPRESSED "transformation script has been validated".
        const result: ValidationResult = {
          kind: 'expressed',
          valid: true,
          conditionIndex: i,
          conditionName: condition.name,
          message: VALIDATED_MESSAGE,
        };
        this.display.display(result.message);
        results.push(result);
      }
    }
    return results;
  }
}
