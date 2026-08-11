/**
 * tagging-interface-panel — src/core/taggedObjects.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: TAGGED
 * OBJECTS FIELD (418) E TAGGED PROPERTIES FIELD — exibem todas as tags criadas
 * associadas ao conteúdo em um só lugar, permitem modificar qualquer tag,
 * selecionar um objeto tagueado para vincular uma property tag e selecionar
 * 2+ objetos (ou 2+ propriedades) para uma link tag. Nenhum texto dos claims
 * é reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

import type { Tag, TaggedObject } from './types.js';

/** Alterações permitidas em uma tag já criada. */
export interface TagChanges {
  title?: string;
  type?: string;
}

function toTaggedObject(tag: Tag): TaggedObject {
  return { tagId: tag.id, title: tag.title, type: tag.type };
}

/**
 * Tagged objects field (418): mantém TODAS as tags criadas associadas ao
 * conteúdo e oferece listagem, modificação e seleção para vínculos.
 */
export class TaggedObjectsField {
  private readonly tags = new Map<string, Tag>();
  private readonly synced = new Map<string, string>();

  /** Registra uma tag criada no field. */
  add(tag: Tag): void {
    this.tags.set(tag.id, tag);
  }

  /** Lista todos os object tags criados, em ordem de criação. */
  listObjectTags(): TaggedObject[] {
    const result: TaggedObject[] = [];
    for (const tag of this.tags.values()) {
      if (tag.kind !== 'object') continue;
      const tagged = toTaggedObject(tag);
      const syncedObjectId = this.synced.get(tag.id);
      if (syncedObjectId !== undefined) tagged.syncedObjectId = syncedObjectId;
      result.push(tagged);
    }
    return result;
  }

  /** Lista todas as property tags criadas, em ordem de criação. */
  listPropertyTags(): Tag[] {
    return [...this.tags.values()].filter((t) => t.kind === 'property');
  }

  /** Lista todas as tags (qualquer opção), em ordem de criação. */
  listAll(): Tag[] {
    return [...this.tags.values()];
  }

  /** Busca uma tag pelo id. */
  get(tagId: string): Tag | undefined {
    return this.tags.get(tagId);
  }

  /** Modifica título e/ou tipo de qualquer tag criada. */
  modify(tagId: string, changes: TagChanges): Tag {
    const tag = this.tags.get(tagId);
    if (tag === undefined) {
      throw new Error(`tag não encontrada: ${tagId}`);
    }
    const updated: Tag = {
      ...tag,
      title: changes.title ?? tag.title,
      type: changes.type ?? tag.type,
    };
    this.tags.set(tagId, updated);
    return updated;
  }

  /** Marca um object tag como sincronizado com um objeto do internal database. */
  markSynced(tagId: string, objectId: string): void {
    const tag = this.tags.get(tagId);
    if (tag === undefined) {
      throw new Error(`tag não encontrada: ${tagId}`);
    }
    if (tag.kind !== 'object') {
      throw new Error(`tag ${tagId} não é um object tag`);
    }
    this.synced.set(tagId, objectId);
  }

  /** Seleciona um objeto tagueado para vincular uma property tag a ele. */
  selectForPropertyLink(tagId: string): Tag {
    const tag = this.tags.get(tagId);
    if (tag === undefined) {
      throw new Error(`tag não encontrada: ${tagId}`);
    }
    if (tag.kind !== 'object') {
      throw new Error(`tag ${tagId} não é um object tag`);
    }
    return tag;
  }

  /** Seleciona 2+ objetos tagueados para criar uma link tag entre eles. */
  selectForLink(tagIds: readonly string[]): Tag[] {
    if (tagIds.length < 2) {
      throw new Error('link tag exige seleção de 2+ objetos');
    }
    return tagIds.map((id) => this.selectForPropertyLink(id));
  }
}

/**
 * Tagged properties field: análogo ao tagged objects field, mas para
 * property tags — permite selecionar 2+ propriedades para uma link tag.
 */
export class TaggedPropertiesField {
  constructor(private readonly objectsField: TaggedObjectsField) {}

  /** Lista todas as property tags exibidas no field. */
  list(): Tag[] {
    return this.objectsField.listPropertyTags();
  }

  /** Seleciona 2+ property tags para criar uma link tag entre elas. */
  selectPropertiesForLink(tagIds: readonly string[]): Tag[] {
    if (tagIds.length < 2) {
      throw new Error('link tag exige seleção de 2+ propriedades');
    }
    return tagIds.map((id) => {
      const tag = this.objectsField.get(id);
      if (tag === undefined) {
        throw new Error(`tag não encontrada: ${id}`);
      }
      if (tag.kind !== 'property') {
        throw new Error(`tag ${id} não é uma property tag`);
      }
      return tag;
    });
  }
}
