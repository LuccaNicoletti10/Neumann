/**
 * tagging-interface-panel — tests/panel.test.ts
 * Testes do painel orquestrador da tagging interface (450).
 */
import { describe, expect, it } from 'vitest';

import { TaggingInterfacePanel } from '../src/core/panel.js';
import { LoginRequiredError } from '../src/core/search.js';
import { createFixedClock, createIdGenerator, makePanel, sampleOntology } from './helpers.js';

describe('seleção → auto-fill (mecanismos 2 e 3)', () => {
  it('selecionar porção auto-preenche TITLE e TYPE e armazena o conteúdo sob label', () => {
    const panel = makePanel();
    const result = panel.select({
      contentKind: 'text',
      content: 'O rover Curiosity segue viagem em Marte.',
      portion: 'Curiosity',
    });
    expect(result.fields.find((f) => f.id === 'TITLE')?.value).toBe('Curiosity');
    expect(result.fields.find((f) => f.id === 'TYPE')?.value).toBe('Ground Travel');
    expect(panel.contentStore.load(result.contentLabel)).toBe(
      'O rover Curiosity segue viagem em Marte.',
    );
  });

  it('preenchimento manual sobrepõe o auto-preenchimento', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.fillField('TYPE', 'Vehicle');
    expect(panel.currentFields.find((f) => f.id === 'TYPE')?.value).toBe('Vehicle');
  });

  it('pull-down de TYPE lista os object types da ontologia', () => {
    const panel = makePanel();
    const options = panel.pullDown('TYPE');
    expect(options).toContain('Person');
    expect(options).toContain('Vehicle');
  });
});

describe('opções de tag + create tag (mecanismo 4)', () => {
  it('escolher property preserva TITLE/TYPE e adiciona LINK_TO_OBJECT', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    const fields = panel.chooseOption('property');
    expect(fields.map((f) => f.id)).toContain('LINK_TO_OBJECT');
    expect(fields.find((f) => f.id === 'TITLE')?.value).toBe('Curiosity');
  });

  it('Create Tag cria object tag com DateAdded do clock e registra no field (418)', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    const tag = panel.createTag();
    expect(tag.dateAdded).toBe('2014-09-18T12:00:00.000Z');
    expect(tag.user).toBe('analista');
    expect(panel.taggedObjects().map((t) => t.tagId)).toEqual([tag.id]);
  });

  it('property tag vinculada a objeto selecionado no tagged objects field', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    const obj = panel.createTag();
    panel.select({ contentKind: 'text', content: 'c2', portion: 'Smith, Jane' });
    panel.chooseOption('property');
    const alvo = panel.objectsField.selectForPropertyLink(obj.id);
    const prop = panel.createTag({ title: 'Smith, Jane', type: 'Name', targetObjectIds: [alvo.id] });
    expect(prop.kind).toBe('property');
    expect(panel.taggedProperties().map((t) => t.id)).toEqual([prop.id]);
  });

  it('link tag entre 2 objetos selecionados no tagged objects field', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    const a = panel.createTag();
    panel.select({ contentKind: 'text', content: 'c2', portion: 'Odyssey flight' });
    panel.chooseOption('object');
    const b = panel.createTag();
    const selecionados = panel.objectsField.selectForLink([a.id, b.id]);
    panel.chooseOption('link');
    const link = panel.createTag({
      title: 'L',
      type: 'Vehicle',
      targetObjectIds: selecionados.map((t) => t.id),
    });
    expect(link.kind).toBe('link');
    expect(link.targetObjectIds).toEqual([a.id, b.id]);
  });

  it('TYPE modificável após a criação (Ground Travel → Air Travel)', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    const tag = panel.createTag();
    const updated = panel.modifyTag(tag.id, { type: 'Air Travel' });
    expect(updated.type).toBe('Air Travel');
    expect(panel.taggedObjects()[0]?.type).toBe('Air Travel');
  });
});

describe('search / sync / tipos para entidades existentes (mecanismo 6)', () => {
  it('search retorna resultados e sync vincula o objeto existente', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    const tag = panel.createTag();
    const results = panel.search('Curiosity');
    expect(results).toHaveLength(1);
    const synced = panel.sync(tag.id, results[0]?.objectId ?? '');
    expect(synced.syncedObjectId).toBe('obj-curiosity');
    expect(panel.taggedObjects()[0]?.syncedObjectId).toBe('obj-curiosity');
  });

  it('sync sem login lança LoginRequiredError', () => {
    const panel = makePanel({ loggedIn: false });
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    const tag = panel.createTag();
    expect(() => panel.sync(tag.id, 'obj-curiosity')).toThrow(LoginRequiredError);
  });

  it('registerTypesForExisting adiciona tipos para entidades do internal database', () => {
    const panel = makePanel();
    const results = panel.search('Curiosity');
    const ontology = panel.registerTypesForExisting(results);
    expect(ontology.objectTypes.map((o) => o.name)).toContain('Vehicle');
    expect(ontology.propertyTypes.map((p) => p.name)).toContain('Kind');
  });
});

describe('export button (mecanismo 8)', () => {
  it('exporta conteúdo + tags com pares, conversão e combinação de destino', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'texto da página', portion: 'Curiosity' });
    panel.chooseOption('object');
    panel.createTag();
    const result = panel.export('both');
    expect(result.destination).toBe('both');
    expect(result.pairsPerTag).toHaveLength(1);
    expect(result.pairsPerTag[0]?.pairs[0]).toEqual({ parameter: 'TagOption', value: 'Object' });
    expect(result.contentByLabel['content-1']).toBe('texto da página');
    expect(result.converted[0]?.['objectType']).toBe('Ground Travel');
  });

  it('exportação exige login', () => {
    const panel = makePanel({ loggedIn: false });
    expect(() => panel.export()).toThrow(LoginRequiredError);
  });

  it('auto-export ao clicar Create Tag registra exportação', () => {
    const panel = makePanel({ autoExport: true });
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    panel.createTag();
    expect(panel.exports()).toHaveLength(1);
  });
});

describe('renderPanel (ASCII determinístico)', () => {
  it('renderiza campos numerados do FIG. 4 e estado atual', () => {
    const panel = new TaggingInterfacePanel(sampleOntology(), {
      clock: createFixedClock('2014-09-18T12:00:00.000Z'),
      newId: createIdGenerator(),
      user: 'analista',
      loggedIn: true,
    });
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    panel.chooseOption('object');
    panel.createTag();
    const render = panel.renderPanel();
    expect(render).toContain('TAGGING INTERFACE (450)');
    expect(render).toContain('TITLE (412): Curiosity');
    expect(render).toContain('TYPE  (410): Ground Travel');
    expect(render).toContain('Property (404)');
    expect(render).toContain('[x] Object (406)');
    expect(render).toContain('Link (408)');
    expect(render).toContain('Create Tag (414)');
    expect(render).toContain('Export to Internal DB (420)');
    expect(render).toContain('TAGGED OBJECTS (418)');
    expect(render).toContain('tag-1 "Curiosity"');
    expect(render).toContain('SEARCH FOR OBJECT (416)');
  });

  it('duas renderizações do mesmo estado são idênticas (determinismo)', () => {
    const panel = makePanel();
    panel.select({ contentKind: 'text', content: 'c', portion: 'Curiosity' });
    expect(panel.renderPanel()).toBe(panel.renderPanel());
  });
});
