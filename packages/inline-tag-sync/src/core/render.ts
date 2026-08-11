/**
 * inline-tag-sync — src/core/render.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * RENDERIZAÇÃO DAS VISÕES — na in-line tagging interface, o texto tagueado é
 * exibido de forma DIFERENTE do não-tagueado (marcador de tag + destaque:
 * `[TAG:Tipo/Prop]texto[/TAG]`); na object-based interface, os trechos
 * tagueados aparecem em negrito/sublinhado (`**__texto__**`) e a seleção de um
 * trecho tagueado exibe os detalhes/propriedades do objeto vinculado. Nenhum
 * texto dos claims é reproduzido; apenas a funcionalidade é reimplementada de
 * forma original.
 */

import { DOCUMENT_FIELD_IDS, getField } from './document.js';
import type { ObjectStore } from './objectStore.js';
import { objectLabel } from './objectStore.js';
import { tagsInField } from './tagging.js';
import type { Document, DocumentTag } from './types.js';
import { capitalize } from './types.js';

/** Tipo do objeto vinculado à tag (ou "?" se o objeto não existir mais). */
function tagType(tag: DocumentTag, store: ObjectStore): string {
  try {
    return store.getObject(tag.objectId).type;
  } catch {
    return '?';
  }
}

/** Monta o texto de um campo com os trechos tagueados envolvidos por wrappers. */
function renderField(
  doc: Document,
  fieldId: (typeof DOCUMENT_FIELD_IDS)[number],
  store: ObjectStore,
  wrap: (tag: DocumentTag, text: string) => string,
): string {
  const text = getField(doc, fieldId).text;
  const tags = tagsInField(doc, fieldId);
  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    const start = Math.min(tag.start, text.length);
    const end = Math.min(tag.end, text.length);
    out += text.slice(cursor, start);
    out += wrap(tag, text.slice(start, end));
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}

function renderDocument(
  doc: Document,
  store: ObjectStore,
  wrap: (tag: DocumentTag, text: string) => string,
): string {
  const lines: string[] = [];
  for (const fieldId of DOCUMENT_FIELD_IDS) {
    const field = getField(doc, fieldId);
    lines.push(`## ${field.label}`);
    lines.push(renderField(doc, fieldId, store, wrap));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Visão da IN-LINE TAGGING INTERFACE: trechos tagueados ganham marcador de tag
 * `[TAG:Tipo/Prop]...[/TAG]` (ícone + destaque), diferente do texto comum.
 */
export function renderInlineView(doc: Document, store: ObjectStore): string {
  return renderDocument(doc, store, (tag, text) => {
    const marker = `[TAG:${tagType(tag, store)}/${capitalize(tag.propertyKey)}]`;
    return `${marker}${text}[/TAG]`;
  });
}

/**
 * Visão da OBJECT-BASED INTERFACE: trechos tagueados exibidos em
 * negrito/sublinhado (`**__texto__**`).
 */
export function renderObjectBasedView(doc: Document, store: ObjectStore): string {
  return renderDocument(doc, store, (_tag, text) => `**__${text}__**`);
}

/**
 * Detalhes exibidos ao SELECIONAR um trecho tagueado na object-based
 * interface: objeto vinculado, propriedade tagueada e demais propriedades.
 */
export function renderTagDetails(
  doc: Document,
  tagId: string,
  store: ObjectStore,
): string {
  const tag = doc.tags.find((candidate) => candidate.id === tagId);
  if (tag === undefined) {
    throw new Error(`tag não encontrada no documento: "${tagId}"`);
  }
  const text = getField(doc, tag.field).text.slice(tag.start, tag.end);
  const lines: string[] = [];
  lines.push(
    `Trecho: "${text}" (campo ${tag.field}, offsets [${tag.start}, ${tag.end}))`,
  );
  lines.push(`Origem da tag: ${tag.origin} (aplicada por ${tag.userId})`);
  try {
    const object = store.getObject(tag.objectId);
    lines.push(`Objeto: ${objectLabel(object)} [${object.type}] (${object.id})`);
    lines.push(
      `Propriedade tagueada: ${capitalize(tag.propertyKey)} = ` +
        (object.properties[tag.propertyKey] ?? ''),
    );
    lines.push('Propriedades do objeto:');
    for (const key of Object.keys(object.properties).sort()) {
      lines.push(`  - ${key}: ${object.properties[key] ?? ''}`);
    }
  } catch {
    lines.push(`Objeto: ${tag.objectId} (não encontrado no object store)`);
  }
  return lines.join('\n');
}
