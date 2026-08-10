/**
 * Passo 3 / US20250298632A1 (config de ambiente editavel remotamente):
 * ConfigIndexer — recebe o texto do configuration file (separado do
 * artefato) e gera a indexed data structure: cada no (chave/valor) com
 * location identifiers (offsets start/end + path logico). O indice e
 * consumido pelo GuiGenerator e pelo ChangeComputer.
 */
import {
  parseJsonWithOffsets,
  type IndexedNode,
  type JsonNodeType,
} from './json-offsets.js';

export interface IndexedConfig {
  /** Texto original indexado (hash serve para detectar mudancas externas). */
  text: string;
  /** path -> no indexado (inclui folhas e agregados). */
  byPath: Map<string, IndexedNode>;
  /** Todos os nos, em ordem de documento. */
  nodes: IndexedNode[];
  /** Valor parseado (arvore). */
  value: unknown;
}

export class ConfigIndexer {
  index(text: string): IndexedConfig {
    const parsed = parseJsonWithOffsets(text);
    const byPath = new Map<string, IndexedNode>();
    for (const node of parsed.nodes) byPath.set(node.path, node);
    return { text, byPath, nodes: parsed.nodes, value: parsed.value };
  }

  /** Folhas editaveis (string/number/boolean/null), em ordem de documento. */
  leaves(indexed: IndexedConfig): IndexedNode[] {
    return indexed.nodes.filter((n) => isLeafType(n.type));
  }

  get(indexed: IndexedConfig, path: string): IndexedNode | undefined {
    return indexed.byPath.get(path);
  }
}

export function isLeafType(t: JsonNodeType): boolean {
  return t === 'string' || t === 'number' || t === 'boolean' || t === 'null';
}