/**
 * link-consistency-validator — builder do script de transformação.
 *
 * Implementa funcionalmente o "builder" que executa a DSL do script de
 * transformação (patente US 8,930,897 B2): produz as ENTIDADES DEFINIDAS
 * (objeto/propriedade) e os LINKS CRIADOS entre duas entidades, e expõe as
 * CONDIÇÕES declaradas no script para a operação de depuração.
 */
import { parseDsl, type ParsedScript } from './dsl.js';
import { entityKey, type Condition, type Entity, type Link } from './types.js';

export class BuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuilderError';
  }
}

export class ScriptBuilder {
  private readonly entityMap = new Map<string, Entity>();
  private readonly createdLinks: Link[] = [];
  readonly conditions: Condition[];

  private constructor(parsed: ParsedScript) {
    for (const entity of parsed.entities) {
      const key = entityKey(entity);
      const existing = this.entityMap.get(key);
      if (existing) {
        throw new BuilderError(`entidade duplicada no builder: "${key}"`);
      }
      if (entity.kind === 'property' && !this.entityMap.has(entity.parent as string)) {
        throw new BuilderError(
          `propriedade "${key}" definida antes do objeto pai "${entity.parent}"`,
        );
      }
      this.entityMap.set(key, entity);
    }
    for (const link of parsed.links) {
      for (const endpoint of [link.from, link.to]) {
        if (!this.entityMap.has(endpoint)) {
          throw new BuilderError(`link referencia entidade não definida no builder: "${endpoint}"`);
        }
      }
      this.createdLinks.push(link);
    }
    this.conditions = parsed.conditions;
  }

  /** Executa a DSL e produz o builder (entidades definidas + links criados). */
  static fromDsl(source: string): ScriptBuilder {
    return new ScriptBuilder(parseDsl(source));
  }

  /** Entidades definidas no builder, em ordem de declaração. */
  get entities(): Entity[] {
    return [...this.entityMap.values()];
  }

  /** Links criados no builder, em ordem de declaração. */
  get links(): Link[] {
    return [...this.createdLinks];
  }

  /** Definição de entidade pelo nome qualificado ("Pessoa" ou "Pessoa.nome"). */
  entity(name: string): Entity | undefined {
    return this.entityMap.get(name);
  }

  /** Link criado que casa exatamente from/predicate/to (undefined se ausente). */
  createdLink(link: Link): Link | undefined {
    return this.createdLinks.find(
      (l) => l.from === link.from && l.predicate === link.predicate && l.to === link.to,
    );
  }
}
