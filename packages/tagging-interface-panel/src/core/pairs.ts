/**
 * tagging-interface-panel — src/core/pairs.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: PARES
 * PARÂMETRO-VALOR + CACHE DE CONTEÚDO — a API coleta as tags e o conteúdo como
 * pares parâmetro-valor (TagOption, Title, Type, Content, DateAdded vindo do
 * clock, User) e o conteúdo externo é armazenado sob um label em um
 * cache/diretório associado à interface (texto, representação, caracteres
 * alfanuméricos e/ou dados audiovisuais). Nenhum texto dos claims é
 * reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

import type { IdGenerator, ParameterValuePair, Tag, TagOption } from './types.js';

/** Capitaliza a opção de tag para o par TagOption (ex.: 'object' → 'Object'). */
export function tagOptionLabel(option: TagOption): string {
  switch (option) {
    case 'object':
      return 'Object';
    case 'property':
      return 'Property';
    case 'link':
      return 'Link';
  }
}

/**
 * Coleta a tag como pares parâmetro-valor, na ordem fixa:
 * TagOption, Title, Type, Content (label do conteúdo), DateAdded (clock),
 * User. Determinístico: nenhum valor depende de relógio real ou aleatório.
 */
export function gatherParameterValuePairs(tag: Tag): ParameterValuePair[] {
  return [
    { parameter: 'TagOption', value: tagOptionLabel(tag.kind) },
    { parameter: 'Title', value: tag.title },
    { parameter: 'Type', value: tag.type },
    { parameter: 'Content', value: tag.contentLabel },
    { parameter: 'DateAdded', value: tag.dateAdded },
    { parameter: 'User', value: tag.user },
  ];
}

/**
 * Cache/diretório associado à interface: armazena o conteúdo externo sob um
 * label (conteúdo textual, representação, caracteres alfanuméricos e/ou dados
 * audiovisuais serializados). Labels determinísticos via IdGenerator.
 */
export class ContentLabelStore {
  private readonly byLabel = new Map<string, string>();

  constructor(private readonly newId: IdGenerator) {}

  /** Armazena o conteúdo sob um novo label e devolve o label. */
  save(content: string): string {
    const label = this.newId('content');
    this.byLabel.set(label, content);
    return label;
  }

  /** Recupera o conteúdo associado ao label (ou undefined). */
  load(label: string): string | undefined {
    return this.byLabel.get(label);
  }

  /** Verifica se o label existe no cache. */
  has(label: string): boolean {
    return this.byLabel.has(label);
  }

  /** Lista os labels armazenados, em ordem de inserção. */
  labels(): string[] {
    return [...this.byLabel.keys()];
  }
}
