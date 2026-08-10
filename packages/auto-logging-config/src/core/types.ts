/**
 * Tipos compartilhados entre os componentes do sistema de configuracao
 * automatica de logging (implementacao funcional independente da US 11,681,606 B2).
 */

/** Chamada de logging identificada no codigo-fonte (SourceCodeModule). */
export interface LoggingCallExpression {
  file: string;
  line: number;
  /** Nome da funcao que envolve a chamada (quando detectada). */
  function: string;
  /** Primeiro argumento string literal da chamada (format string), se houver. */
  formatString: string;
  /** Quantidade total de argumentos da chamada. */
  argCount: number;
}

/** Parametro de um search pattern, derivado de um especificador de formato. */
export interface PatternParam {
  name: string;
  type: "number" | "string" | "any";
}

/** Padrao de busca (regex) que reconhece uma mensagem de saida (SearchPatternModule). */
export interface SearchPattern {
  id: string;
  source: { file: string; line: number; function: string };
  /** Regex (string) que reconhece a mensagem correspondente. */
  regex: string;
  /** Porcoes estaticas da format string. */
  staticParts: string[];
  params: PatternParam[];
  matchCount: number;
}

/** Entrada de log estruturada produzida pelo LogEntryComponent. */
export interface StructuredLogEntry {
  patternId: string;
  message: string;
  staticMatched: boolean;
  params: Record<string, string>;
  timestamp: string;
  sourceFunction?: string;
}
