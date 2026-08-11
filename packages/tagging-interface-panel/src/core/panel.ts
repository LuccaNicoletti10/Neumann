/**
 * tagging-interface-panel — src/core/panel.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: PAINEL DA
 * TAGGING INTERFACE (450) — orquestra o fluxo completo do painel exibido por
 * bookmarklet/plugin sobre conteúdo externo no browser: seleção de porção →
 * auto-preenchimento de TITLE/TYPE → escolha da opção de tag → Create Tag →
 * tagged objects field → busca/sincronização no internal database →
 * exportação, com renderização ASCII determinística do painel. Nenhum texto
 * dos claims é reproduzido; apenas a funcionalidade é reimplementada de forma
 * original.
 */

import { autoPopulate, manualFill, pullDownOptions } from './fields.js';
import type { TypeInferenceRule } from './fields.js';
import { createOntologyBuilder, OntologyBuilder } from './ontology.js';
import { createTagButton, fieldsForOption } from './options.js';
import { ContentLabelStore, gatherParameterValuePairs } from './pairs.js';
import {
  createInMemoryDatabase,
  createTypesForExisting,
  LoginRequiredError,
  searchForObject,
  syncTaggedObject,
} from './search.js';
import type { InternalDatabase } from './search.js';
import { TaggedObjectsField, TaggedPropertiesField } from './taggedObjects.js';
import type { TagChanges } from './taggedObjects.js';
import type {
  Clock,
  ContentKind,
  IdGenerator,
  InterfaceField,
  Ontology,
  ParameterValuePair,
  SearchResult,
  Tag,
  TagOption,
  TaggedObject,
} from './types.js';
import { createFixedClock, createIdGenerator } from './types.js';

/** Dependências injetáveis do painel (determinismo total). */
export interface PanelDeps {
  clock?: Clock;
  newId?: IdGenerator;
  user?: string;
  loggedIn?: boolean;
  internalDb?: InternalDatabase;
  /** Quando true, clicar em Create Tag já exporta automaticamente. */
  autoExport?: boolean;
  typeRules?: readonly TypeInferenceRule[];
}

/** Entrada da seleção de porção do conteúdo externo. */
export interface SelectInput {
  contentKind: ContentKind;
  /** Conteúdo completo exibido no browser (armazenado no cache sob label). */
  content: string;
  /** Porção selecionada pelo usuário. */
  portion: string;
}

/** Resultado da seleção: campos auto-preenchidos + label do conteúdo. */
export interface SelectionResult {
  fields: InterfaceField[];
  contentLabel: string;
}

/** Destinos de exportação suportados (combinações de armazenamento). */
export type ExportDestination = 'external' | 'internal' | 'both';

/** Resultado da exportação para o internal database. */
export interface ExportResult {
  destination: ExportDestination;
  tags: Tag[];
  /** Pares parâmetro-valor por tag, em ordem de criação. */
  pairsPerTag: { tagId: string; pairs: ParameterValuePair[] }[];
  /** Conteúdo externo exportado, por label do cache. */
  contentByLabel: Record<string, string>;
  /** Conversão das tags para o formato do internal database. */
  converted: Record<string, string>[];
}

/** Painel da tagging interface (450): orquestra todos os mecanismos. */
export class TaggingInterfacePanel {
  private readonly clock: Clock;
  private readonly newId: IdGenerator;
  private readonly user: string;
  private readonly loggedIn: boolean;
  private readonly internalDb?: InternalDatabase;
  private readonly autoExport: boolean;
  private readonly typeRules?: readonly TypeInferenceRule[];
  private readonly ontologyBuilder: OntologyBuilder;
  private readonly store: ContentLabelStore;
  readonly objectsField = new TaggedObjectsField();
  readonly propertiesField: TaggedPropertiesField;

  private option: TagOption = 'object';
  private fields: InterfaceField[] = fieldsForOption('object');
  private contentLabel = '';
  private lastSearch: SearchResult[] = [];
  private readonly exportLog: ExportResult[] = [];

  constructor(ontology: Ontology, deps: PanelDeps = {}) {
    this.clock = deps.clock ?? createFixedClock('2014-09-18T00:00:00.000Z');
    this.newId = deps.newId ?? createIdGenerator();
    this.user = deps.user ?? 'anon';
    this.loggedIn = deps.loggedIn ?? false;
    if (deps.internalDb !== undefined) this.internalDb = deps.internalDb;
    this.autoExport = deps.autoExport ?? false;
    if (deps.typeRules !== undefined) this.typeRules = deps.typeRules;
    // Re-semeia o builder a partir da ontologia recebida (cópia interna).
    const builder = createOntologyBuilder(ontology.name);
    for (const objectType of ontology.objectTypes) {
      builder.addObjectType(objectType.name, objectType.description);
    }
    for (const propertyType of ontology.propertyTypes) {
      builder.addPropertyType(propertyType);
    }
    for (const definition of ontology.parserDefinitions) {
      builder.addParserDefinition(definition);
    }
    this.ontologyBuilder = builder;
    this.store = new ContentLabelStore(this.newId);
    this.propertiesField = new TaggedPropertiesField(this.objectsField);
  }

  /** Ontologia corrente (inclui tipos criados para entidades existentes). */
  getOntology(): Ontology {
    return this.ontologyBuilder.build();
  }

  /** Opção de tag atualmente selecionada. */
  get selectedOption(): TagOption {
    return this.option;
  }

  /** Campos atualmente exibidos no painel. */
  get currentFields(): InterfaceField[] {
    return this.fields.map((f) => ({ ...f }));
  }

  /**
   * Seleção de porção do conteúdo: o conteúdo é armazenado sob um label no
   * cache associado à interface e os campos TITLE (412) e TYPE (410) são
   * auto-preenchidos conforme o tipo do conteúdo.
   */
  select(input: SelectInput): SelectionResult {
    this.contentLabel = this.store.save(input.content);
    const populated = autoPopulate({
      contentKind: input.contentKind,
      selectedText: input.portion,
      rules: this.typeRules,
    });
    this.fields = manualFill(this.fieldsForCurrentOption(), 'TITLE', populated.title);
    this.fields = manualFill(this.fields, 'TYPE', populated.type);
    return { fields: this.currentFields, contentLabel: this.contentLabel };
  }

  /** Seleciona a opção de tag (404 property, 406 object, 408 link). */
  chooseOption(option: TagOption): InterfaceField[] {
    this.option = option;
    const title = this.fields.find((f) => f.id === 'TITLE')?.value;
    const type = this.fields.find((f) => f.id === 'TYPE')?.value;
    let next = fieldsForOption(option);
    if (title !== undefined) next = manualFill(next, 'TITLE', title);
    if (type !== undefined) next = manualFill(next, 'TYPE', type);
    this.fields = next;
    return this.currentFields;
  }

  /** Preenche manualmente um campo do painel. */
  fillField(fieldId: string, value: string): InterfaceField[] {
    this.fields = manualFill(this.fields, fieldId, value);
    return this.currentFields;
  }

  /** Opções de lista pull-down de um campo (ex.: TYPE com os object types). */
  pullDown(fieldId: string): string[] {
    const types = this.getOntology().objectTypes.map((o) => o.name);
    return pullDownOptions(fieldId, types);
  }

  /**
   * Create Tag button (414): cria a tag associada à porção selecionada e a
   * registra no tagged objects field (418). Com autoExport, exporta
   * automaticamente ao criar (exige login).
   */
  createTag(overrides: Partial<Pick<Tag, 'title' | 'type'>> & {
    targetObjectIds?: string[];
    targetPropertyIds?: string[];
  } = {}): Tag {
    const title = overrides.title ?? this.fields.find((f) => f.id === 'TITLE')?.value ?? '';
    const type = overrides.type ?? this.fields.find((f) => f.id === 'TYPE')?.value ?? '';
    const tag = createTagButton(
      {
        option: this.option,
        title,
        type,
        contentLabel: this.contentLabel,
        targetObjectIds: overrides.targetObjectIds ?? [],
        targetPropertyIds: overrides.targetPropertyIds ?? [],
      },
      { clock: this.clock, newId: this.newId, user: this.user },
    );
    this.objectsField.add(tag);
    if (this.autoExport) {
      this.export('both');
    }
    return tag;
  }

  /** Modifica qualquer tag já criada (título e/ou TYPE, ex.: Ground → Air). */
  modifyTag(tagId: string, changes: TagChanges): Tag {
    return this.objectsField.modify(tagId, changes);
  }

  /** Tagged objects field (418): todos os object tags criados. */
  taggedObjects(): TaggedObject[] {
    return this.objectsField.listObjectTags();
  }

  /** Tagged properties field: todas as property tags criadas. */
  taggedProperties(): Tag[] {
    return this.objectsField.listPropertyTags();
  }

  /** Search for object field (416): busca no internal database system. */
  search(query: string): SearchResult[] {
    if (this.internalDb === undefined) {
      throw new Error('internal database não configurado');
    }
    this.lastSearch = searchForObject(this.internalDb, query);
    return [...this.lastSearch];
  }

  /**
   * SYNC do objeto tagueado com objeto existente no internal database.
   * EXIGE login (LoginRequiredError sem login).
   */
  sync(tagId: string, objectId: string): TaggedObject {
    const tagged = this.objectsField.listObjectTags().find((t) => t.tagId === tagId);
    if (tagged === undefined) {
      throw new Error(`object tag não encontrado: ${tagId}`);
    }
    if (this.internalDb === undefined) {
      throw new Error('internal database não configurado');
    }
    const synced = syncTaggedObject(this.internalDb, tagged, objectId, {
      loggedIn: this.loggedIn,
    });
    this.objectsField.markSynced(tagId, synced.syncedObjectId ?? objectId);
    return synced;
  }

  /** Cria object/property types na ontologia para entidades já existentes. */
  registerTypesForExisting(results: readonly SearchResult[]): Ontology {
    createTypesForExisting(this.ontologyBuilder, results);
    return this.getOntology();
  }

  /**
   * Export button (420): exporta o conteúdo + as tags criadas para o destino
   * escolhido (externo, interno ou ambos), já convertidos para o formato do
   * internal database. EXIGE login (LoginRequiredError sem login).
   */
  export(destination: ExportDestination = 'both'): ExportResult {
    if (!this.loggedIn) {
      throw new LoginRequiredError('exportação para o internal database');
    }
    const tags = this.objectsField.listAll();
    const pairsPerTag = tags.map((tag) => ({
      tagId: tag.id,
      pairs: gatherParameterValuePairs(tag),
    }));
    const contentByLabel: Record<string, string> = {};
    for (const label of this.store.labels()) {
      contentByLabel[label] = this.store.load(label) ?? '';
    }
    const converted = tags.map((tag) => ({
      recordKind: tag.kind,
      objectType: tag.type,
      title: tag.title,
      contentRef: tag.contentLabel,
      dateAdded: tag.dateAdded,
      user: tag.user,
      targets: [...(tag.targetObjectIds ?? []), ...(tag.targetPropertyIds ?? [])].join(','),
    }));
    const result: ExportResult = { destination, tags, pairsPerTag, contentByLabel, converted };
    this.exportLog.push(result);
    return result;
  }

  /** Histórico de exportações realizadas pelo painel. */
  exports(): readonly ExportResult[] {
    return this.exportLog;
  }

  /** Cache de conteúdo associado à interface. */
  get contentStore(): ContentLabelStore {
    return this.store;
  }

  private fieldsForCurrentOption(): InterfaceField[] {
    return fieldsForOption(this.option);
  }

  /** Renderização ASCII determinística do painel (FIG. 4 simplificada). */
  renderPanel(): string {
    const width = 62;
    const line = (text: string): string => {
      const trimmed = text.length > width ? text.slice(0, width) : text;
      return `| ${trimmed.padEnd(width)} |`;
    };
    const bar = `+${'-'.repeat(width + 2)}+`;
    const fieldValue = (id: string): string =>
      this.fields.find((f) => f.id === id)?.value ?? '';
    const mark = (option: TagOption): string => (this.option === option ? 'x' : ' ');
    const rows: string[] = [
      bar,
      line('TAGGING INTERFACE (450) — conteúdo externo no browser'),
      bar,
      line(`TITLE (412): ${fieldValue('TITLE')}`),
      line(`TYPE  (410): ${fieldValue('TYPE')} [pull-down: ${this.pullDown('TYPE').join('/')}]`),
      `| ${'-'.repeat(width)} |`,
      line(
        `Opções: [${mark('property')}] Property (404)  [${mark('object')}] Object (406)  ` +
          `[${mark('link')}] Link (408)`,
      ),
      line('[ Create Tag (414) ]   [ Export to Internal DB (420) ]'),
      `| ${'-'.repeat(width)} |`,
      line('TAGGED OBJECTS (418):'),
    ];
    const objects = this.taggedObjects();
    if (objects.length === 0) {
      rows.push(line('  (nenhum object tag criado)'));
    }
    for (const object of objects) {
      const syncInfo = object.syncedObjectId === undefined ? '' : ` [sync: ${object.syncedObjectId}]`;
      rows.push(line(`  - ${object.tagId} "${object.title}" : ${object.type}${syncInfo}`));
    }
    rows.push(line('TAGGED PROPERTIES:'));
    const properties = this.taggedProperties();
    if (properties.length === 0) {
      rows.push(line('  (nenhuma property tag criada)'));
    }
    for (const property of properties) {
      const target = (property.targetObjectIds ?? []).join(',');
      rows.push(line(`  - ${property.id} "${property.title}" : ${property.type} → ${target}`));
    }
    rows.push(`| ${'-'.repeat(width)} |`);
    rows.push(line(`SEARCH FOR OBJECT (416): ${this.lastSearch.length} resultado(s)`));
    for (const result of this.lastSearch) {
      rows.push(line(`  - ${result.objectId} (${result.objectType})`));
    }
    rows.push(line(`Usuário: ${this.user} | login: ${this.loggedIn ? 'sim' : 'não'}`));
    rows.push(bar);
    return rows.join('\n');
  }
}

/** Ontologia de demonstração (cenário do FIG. 4 adaptado). */
export function createDemoOntology(): Ontology {
  return createOntologyBuilder('tagging-demo')
    .addObjectType('Person')
    .addObjectType('Business')
    .addObjectType('Vehicle')
    .addObjectType('Ground Travel')
    .addObjectType('Air Travel')
    .addPropertyType({
      name: 'Name',
      components: ['Name:Last', 'Name:First'],
      representativeOf: ['Person'],
    })
    .addPropertyType({ name: 'Name:First', representativeOf: ['Person'] })
    .addPropertyType({ name: 'Name:Last', representativeOf: ['Person'] })
    .addPropertyType({ name: 'Social Security Number', representativeOf: ['Person'] })
    .addParserDefinition({
      name: 'name-last-first',
      pattern: '{LAST NAME}, {FIRST NAME}',
      components: [
        { token: 'LAST NAME', propertyType: 'Name:Last' },
        { token: 'FIRST NAME', propertyType: 'Name:First' },
      ],
    })
    .addParserDefinition({
      name: 'name-first-last',
      pattern: '{FIRST NAME} {LAST NAME}',
      components: [
        { token: 'FIRST NAME', propertyType: 'Name:First' },
        { token: 'LAST NAME', propertyType: 'Name:Last' },
      ],
    })
    .build();
}

/** Internal database de demonstração com objetos já existentes. */
export function createDemoInternalDatabase(): InternalDatabase {
  return createInMemoryDatabase([
    {
      objectId: 'obj-curiosity',
      objectType: 'Vehicle',
      properties: { Name: 'Curiosity', Kind: 'Mars rover' },
    },
    {
      objectId: 'obj-odyssey',
      objectType: 'Vehicle',
      properties: { Name: 'Odyssey', Kind: 'aircraft' },
    },
  ]);
}
