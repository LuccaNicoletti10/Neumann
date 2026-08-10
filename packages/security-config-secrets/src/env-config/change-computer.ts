/**
 * Passo 3 / US20250298632A1 (config de ambiente editavel remotamente):
 * ChangeComputer — dado um user input (path -> novo valor), consulta a
 * indexed data structure e produz instructions cirurgicas
 * [{locationId (offsets start/end), deleteCount, insertText}] que editam
 * apenas o valor no texto original, preservando formatacao e comentarios.
 */
import { isLeafType, type IndexedConfig } from './config-indexer.js';
import { serializeScalar } from './json-offsets.js';

export interface EditInstruction {
  /** Location identifier: offsets do valor no texto original. */
  locationId: { start: number; end: number };
  /** Quantidade de caracteres a remover (= end - start). */
  deleteCount: number;
  /** Texto a inserir no lugar. */
  insertText: string;
  /** Path logico alterado (informativo/auditoria). */
  path: string;
}

export type ScalarValue = string | number | boolean | null;

export class ChangeComputer {
  /**
   * Produz a instruction para trocar o valor de `path`. Lanca erro se o
   * path nao existir, nao for folha ou o tipo nao for compativel.
   */
  compute(indexed: IndexedConfig, path: string, newValue: ScalarValue): EditInstruction {
    const node = indexed.byPath.get(path);
    if (!node) throw new Error(`path inexistente no indice: "${path}"`);
    if (!isLeafType(node.type)) {
      throw new Error(`path "${path}" nao e folha editavel (tipo ${node.type})`);
    }
    this.assertTypeCompatible(path, node.type, newValue);
    const insertText = serializeScalar(newValue);
    return {
      locationId: { start: node.start, end: node.end },
      deleteCount: node.end - node.start,
      insertText,
      path,
    };
  }

  computeAll(
    indexed: IndexedConfig,
    changes: Array<{ path: string; value: ScalarValue }>,
  ): EditInstruction[] {
    return changes.map((c) => this.compute(indexed, c.path, c.value));
  }

  private assertTypeCompatible(
    path: string,
    nodeType: string,
    value: ScalarValue,
  ): void {
    const ok =
      (nodeType === 'string' && typeof value === 'string') ||
      (nodeType === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (nodeType === 'boolean' && typeof value === 'boolean') ||
      value === null; // null e aceito em qualquer folha
    if (!ok) {
      throw new Error(
        `tipo incompativel para "${path}": esperado ${nodeType}, recebido ${typeof value}`,
      );
    }
  }
}

/** Aplica instructions ao texto (da maior posicao para a menor). */
export function applyInstructions(text: string, instructions: EditInstruction[]): string {
  const sorted = [...instructions].sort((a, b) => b.locationId.start - a.locationId.start);
  let out = text;
  for (const ins of sorted) {
    const { start, end } = ins.locationId;
    if (start < 0 || end < start || end > out.length) {
      throw new Error(`instruction com offsets invalidos: [${start}, ${end})`);
    }
    if (ins.deleteCount !== end - start) {
      throw new Error(
        `deleteCount=${ins.deleteCount} inconsistente com offsets [${start}, ${end})`,
      );
    }
    out = out.slice(0, start) + ins.insertText + out.slice(end);
  }
  return out;
}