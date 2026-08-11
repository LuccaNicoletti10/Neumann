/**
 * tagging-interface-panel — src/core/options.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: OPÇÕES DE
 * TAG + CREATE TAG BUTTON — selecionar property tag option (404) adiciona um
 * campo para vincular a propriedade a um objeto; link tag option (408)
 * adiciona campos para vincular 2+ objetos ou 2+ propriedades; object tag
 * option (406) usa os campos base; o Create Tag button (414) cria a tag
 * associada à porção selecionada. Nenhum texto dos claims é reproduzido;
 * apenas a funcionalidade é reimplementada de forma original.
 */

import type { Clock, IdGenerator, InterfaceField, Tag, TagOption } from './types.js';

/** Campos base sempre presentes na tagging interface. */
export function baseFields(): InterfaceField[] {
  return [
    { id: 'TITLE', label: 'Title' },
    { id: 'TYPE', label: 'Type' },
  ];
}

/**
 * Campos dinâmicos exibidos ao selecionar uma opção de tag:
 * - object (406): apenas os campos base (TITLE/TYPE);
 * - property (404): base + campo LINK_TO_OBJECT para vincular a propriedade
 *   a um objeto tagueado;
 * - link (408): base + campos LINK_TARGET_1 e LINK_TARGET_2 para vincular
 *   2+ objetos ou 2+ propriedades.
 */
export function fieldsForOption(option: TagOption): InterfaceField[] {
  const base = baseFields();
  switch (option) {
    case 'object':
      return base;
    case 'property':
      return [...base, { id: 'LINK_TO_OBJECT', label: 'Link to Object' }];
    case 'link':
      return [
        ...base,
        { id: 'LINK_TARGET_1', label: 'Link Target 1' },
        { id: 'LINK_TARGET_2', label: 'Link Target 2' },
      ];
  }
}

/** Entrada do Create Tag button (414). */
export interface CreateTagInput {
  option: TagOption;
  title: string;
  type: string;
  contentLabel: string;
  targetObjectIds?: string[];
  targetPropertyIds?: string[];
}

/** Dependências determinísticas para criar uma tag. */
export interface CreateTagDeps {
  clock: Clock;
  newId: IdGenerator;
  user: string;
}

/**
 * Create Tag button (414): valida os vínculos exigidos por cada opção e cria
 * a tag associada à porção selecionada (contentLabel). Regras:
 * - property: exige exatamente 1 objeto alvo (LINK_TO_OBJECT);
 * - link: exige 2+ objetos OU 2+ propriedades alvo;
 * - object: sem vínculos adicionais.
 * DateAdded vem do clock injetável (determinismo total).
 */
export function createTagButton(input: CreateTagInput, deps: CreateTagDeps): Tag {
  if (input.title.trim() === '') {
    throw new Error('TITLE não pode ser vazio');
  }
  if (input.type.trim() === '') {
    throw new Error('TYPE não pode ser vazio');
  }
  const targetObjectIds = [...(input.targetObjectIds ?? [])];
  const targetPropertyIds = [...(input.targetPropertyIds ?? [])];
  if (input.option === 'property' && targetObjectIds.length !== 1) {
    throw new Error('property tag exige exatamente 1 objeto alvo (LINK_TO_OBJECT)');
  }
  if (
    input.option === 'link' &&
    targetObjectIds.length < 2 &&
    targetPropertyIds.length < 2
  ) {
    throw new Error('link tag exige 2+ objetos ou 2+ propriedades alvo');
  }
  const tag: Tag = {
    id: deps.newId('tag'),
    kind: input.option,
    title: input.title,
    type: input.type,
    contentLabel: input.contentLabel,
    dateAdded: deps.clock(),
    user: deps.user,
  };
  if (targetObjectIds.length > 0) tag.targetObjectIds = targetObjectIds;
  if (targetPropertyIds.length > 0) tag.targetPropertyIds = targetPropertyIds;
  return tag;
}
