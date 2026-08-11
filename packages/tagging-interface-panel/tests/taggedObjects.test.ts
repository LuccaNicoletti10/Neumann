/**
 * tagging-interface-panel — tests/taggedObjects.test.ts
 * Testes do tagged objects field (418) e do tagged properties field.
 */
import { describe, expect, it } from 'vitest';

import { TaggedObjectsField, TaggedPropertiesField } from '../src/core/taggedObjects.js';
import type { Tag } from '../src/core/types.js';

function objectTag(id: string, title: string): Tag {
  return {
    id,
    kind: 'object',
    title,
    type: 'Ground Travel',
    contentLabel: 'content-1',
    dateAdded: '2014-09-18T12:00:00.000Z',
    user: 'analista',
  };
}

function propertyTag(id: string, target: string): Tag {
  return {
    id,
    kind: 'property',
    title: 'Smith, Jane',
    type: 'Name',
    contentLabel: 'content-1',
    dateAdded: '2014-09-18T12:00:00.000Z',
    user: 'analista',
    targetObjectIds: [target],
  };
}

describe('TaggedObjectsField (418)', () => {
  it('lista todos os object tags criados em um só lugar, em ordem', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    field.add(objectTag('tag-2', 'Odyssey'));
    field.add(propertyTag('tag-3', 'tag-1'));
    const list = field.listObjectTags();
    expect(list.map((t) => t.title)).toEqual(['Curiosity', 'Odyssey']);
  });

  it('permite modificar qualquer tag criada (título e TYPE)', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    const updated = field.modify('tag-1', { type: 'Air Travel' });
    expect(updated.type).toBe('Air Travel');
    expect(field.get('tag-1')?.type).toBe('Air Travel');
  });

  it('modify em tag inexistente lança erro', () => {
    const field = new TaggedObjectsField();
    expect(() => field.modify('tag-9', {})).toThrow(/tag não encontrada/);
  });

  it('seleciona um objeto tagueado para vincular property tag', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    const selected = field.selectForPropertyLink('tag-1');
    expect(selected.id).toBe('tag-1');
  });

  it('não seleciona property tag como alvo de property link', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    field.add(propertyTag('tag-2', 'tag-1'));
    expect(() => field.selectForPropertyLink('tag-2')).toThrow(/não é um object tag/);
  });

  it('seleciona 2+ objetos para link tag', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    field.add(objectTag('tag-2', 'Odyssey'));
    const selected = field.selectForLink(['tag-1', 'tag-2']);
    expect(selected.map((t) => t.id)).toEqual(['tag-1', 'tag-2']);
  });

  it('link com menos de 2 objetos lança erro', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    expect(() => field.selectForLink(['tag-1'])).toThrow(/2\+ objetos/);
  });

  it('markSynced registra o objeto do internal database', () => {
    const field = new TaggedObjectsField();
    field.add(objectTag('tag-1', 'Curiosity'));
    field.markSynced('tag-1', 'obj-curiosity');
    const tagged = field.listObjectTags()[0];
    expect(tagged?.syncedObjectId).toBe('obj-curiosity');
  });
});

describe('TaggedPropertiesField', () => {
  it('lista as property tags criadas', () => {
    const objects = new TaggedObjectsField();
    objects.add(objectTag('tag-1', 'Curiosity'));
    objects.add(propertyTag('tag-2', 'tag-1'));
    objects.add(propertyTag('tag-3', 'tag-1'));
    const props = new TaggedPropertiesField(objects);
    expect(props.list().map((t) => t.id)).toEqual(['tag-2', 'tag-3']);
  });

  it('seleciona 2+ propriedades para link tag', () => {
    const objects = new TaggedObjectsField();
    objects.add(objectTag('tag-1', 'Curiosity'));
    objects.add(propertyTag('tag-2', 'tag-1'));
    objects.add(propertyTag('tag-3', 'tag-1'));
    const props = new TaggedPropertiesField(objects);
    const selected = props.selectPropertiesForLink(['tag-2', 'tag-3']);
    expect(selected.map((t) => t.id)).toEqual(['tag-2', 'tag-3']);
  });

  it('rejeita seleção de menos de 2 propriedades ou de não-property', () => {
    const objects = new TaggedObjectsField();
    objects.add(objectTag('tag-1', 'Curiosity'));
    objects.add(propertyTag('tag-2', 'tag-1'));
    const props = new TaggedPropertiesField(objects);
    expect(() => props.selectPropertiesForLink(['tag-2'])).toThrow(/2\+ propriedades/);
    expect(() => props.selectPropertiesForLink(['tag-1', 'tag-2'])).toThrow(
      /não é uma property tag/,
    );
  });
});
