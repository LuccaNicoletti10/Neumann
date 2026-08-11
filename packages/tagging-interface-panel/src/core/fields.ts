/**
 * tagging-interface-panel — src/core/fields.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: CAMPOS DA
 * TAGGING INTERFACE — auto-preenchimento dos campos TITLE (412) e TYPE (410)
 * ao selecionar uma porção do conteúdo (texto selecionado → TITLE; TYPE
 * inferido por regras determinísticas, ex.: "Ground Travel"), preenchimento
 * manual, opções de lista pull-down e modificação do TYPE após a criação da
 * tag (ex.: "Ground Travel" → "Air Travel"). Nenhum texto dos claims é
 * reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

import type { ContentKind, InterfaceField, Tag } from './types.js';

/** Regra determinística de inferência do campo TYPE. */
export interface TypeInferenceRule {
  pattern: RegExp;
  type: string;
}

/**
 * Regras padrão de inferência de TYPE, avaliadas em ordem; a primeira que
 * casar vence. Sem casamento, o TYPE padrão é "Text".
 */
export const DEFAULT_TYPE_RULES: readonly TypeInferenceRule[] = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, type: 'Social Security Number' },
  { pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/, type: 'Email Address' },
  { pattern: /\b(?:flight|airline|airport|air travel)\b/i, type: 'Air Travel' },
  {
    pattern: /\b(?:ground travel|taxi|cab|rental car|train|bus|rover|curiosity)\b/i,
    type: 'Ground Travel',
  },
];

/** TYPE usado quando nenhuma regra de inferência casa. */
export const DEFAULT_FALLBACK_TYPE = 'Text';

/** Entrada do auto-preenchimento. */
export interface AutoPopulateInput {
  contentKind: ContentKind;
  selectedText: string;
  rules?: readonly TypeInferenceRule[];
}

/** Campos TITLE e TYPE auto-preenchidos. */
export interface AutoPopulatedFields {
  title: string;
  type: string;
}

/**
 * Auto-preenche TITLE (412) e TYPE (410) conforme o tipo do conteúdo:
 * - texto → TITLE = texto selecionado; TYPE inferido pelas regras;
 * - conteúdo audiovisual (image/audio/video) → TITLE = rótulo informado
 *   (ou marcador de conteúdo audiovisual); TYPE inferido pelas regras.
 */
export function autoPopulate(input: AutoPopulateInput): AutoPopulatedFields {
  const rules = input.rules ?? DEFAULT_TYPE_RULES;
  const trimmed = input.selectedText.trim();
  const title =
    input.contentKind === 'text' ? trimmed : trimmed === '' ? '<conteúdo audiovisual>' : trimmed;
  let type = DEFAULT_FALLBACK_TYPE;
  for (const rule of rules) {
    if (rule.pattern.test(trimmed)) {
      type = rule.type;
      break;
    }
  }
  return { title, type };
}

/** Preenche manualmente o valor de um campo da interface (retorna cópia). */
export function manualFill(
  fields: readonly InterfaceField[],
  fieldId: string,
  value: string,
): InterfaceField[] {
  return fields.map((field) => (field.id === fieldId ? { ...field, value } : { ...field }));
}

/**
 * Opções de lista pull-down de um campo: TYPE lista os tipos disponíveis
 * (object types da ontologia); OPTION lista as três opções de tag.
 */
export function pullDownOptions(fieldId: string, availableTypes: readonly string[]): string[] {
  switch (fieldId) {
    case 'TYPE':
      return [...availableTypes];
    case 'OPTION':
      return ['property', 'object', 'link'];
    default:
      return [];
  }
}

/**
 * Modifica o TYPE de uma tag já criada (o TYPE permanece editável após a
 * criação — ex.: "Ground Travel" → "Air Travel"). Retorna uma NOVA tag.
 */
export function modifyAfterCreate(tag: Tag, newType: string): Tag {
  if (newType.trim() === '') {
    throw new Error('TYPE não pode ser vazio');
  }
  return { ...tag, type: newType };
}
