/**
 * external-content-exporter — src/core/internalDb.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: INTERNAL DATABASE SYSTEM —
 * armazena o conteúdo externo exportado em data sources e os pares
 * parâmetro-valor no database segundo a ontology/object model (objeto,
 * propriedade ou link), com consulta por label do conteúdo. Nenhum texto dos
 * claims é reproduzido; apenas a funcionalidade é reimplementada de forma
 * original.
 */

import { createIdGenerator } from './determinism.js';
import { CoreError } from './types.js';
import type {
  ExternalContent,
  IdGenerator,
  ParameterValuePair,
  TagOption,
} from './types.js';

/** Registro de pares armazenado no database segundo a ontology/object model. */
export interface PairRecord {
  /** Identificador determinístico (ex.: "record-1"). */
  id: string;
  /** Classe da ontologia derivada do TagOption (object/property/link). */
  ontologyClass: TagOption;
  /** Tipo dentro da classe (Tag.type, ex.: "Person"). */
  objectType: string;
  /** Label do conteúdo associado (par Content=<label>). */
  contentLabel: string;
  pairs: ParameterValuePair[];
}

/** Entrada de data source que guarda o conteúdo externo exportado. */
export interface DataSourceEntry {
  /** Identificador determinístico (ex.: "datasource-1"). */
  id: string;
  label: string;
  content: ExternalContent;
}

/** Internal database system: data sources + database por ontologia. */
export interface InternalDatabase {
  /** Armazena o conteúdo externo em um data source; devolve o id. */
  storeContent(content: ExternalContent): DataSourceEntry;
  /** Armazena os pares parâmetro-valor no database; devolve o registro. */
  storePairs(pairs: readonly ParameterValuePair[]): PairRecord;
  /** Consulta registros de pares pelo label do conteúdo. */
  queryByLabel(label: string): PairRecord[];
  getRecord(recordId: string): PairRecord | undefined;
  getDataSource(dataSourceId: string): DataSourceEntry | undefined;
  listDataSources(): DataSourceEntry[];
  listRecords(): PairRecord[];
}

export interface InternalDbDeps {
  nextId?: IdGenerator;
}

/** Extrai o valor de um parâmetro dos pares (ou lança erro de conversão). */
function pairValue(pairs: readonly ParameterValuePair[], name: string): string {
  const pair = pairs.find((candidate) => candidate.parameter === name);
  if (pair === undefined) {
    throw new CoreError('MISSING_PARAMETER', `par ausente nos pares exportados: ${name}`);
  }
  return pair.value;
}

/** Cria o internal database system (em memória, determinístico). */
export function createInternalDb(deps: InternalDbDeps = {}): InternalDatabase {
  const nextId = deps.nextId ?? createIdGenerator();
  const dataSources = new Map<string, DataSourceEntry>();
  const records = new Map<string, PairRecord>();

  return {
    storeContent(content: ExternalContent): DataSourceEntry {
      const entry: DataSourceEntry = {
        id: nextId('datasource'),
        label: content.label,
        content: { ...content },
      };
      dataSources.set(entry.id, entry);
      return { ...entry, content: { ...entry.content } };
    },
    storePairs(pairs: readonly ParameterValuePair[]): PairRecord {
      const tagOption = pairValue(pairs, 'TagOption') as TagOption;
      if (tagOption !== 'object' && tagOption !== 'property' && tagOption !== 'link') {
        throw new CoreError(
          'INVALID_ONTOLOGY_CLASS',
          `TagOption fora da ontology/object model: ${tagOption}`,
        );
      }
      const record: PairRecord = {
        id: nextId('record'),
        ontologyClass: tagOption,
        objectType: pairValue(pairs, 'Type'),
        contentLabel: pairValue(pairs, 'Content'),
        pairs: pairs.map((pair) => ({ ...pair })),
      };
      records.set(record.id, record);
      return { ...record, pairs: record.pairs.map((pair) => ({ ...pair })) };
    },
    queryByLabel(label: string): PairRecord[] {
      return [...records.values()]
        .filter((record) => record.contentLabel === label)
        .map((record) => ({ ...record, pairs: record.pairs.map((pair) => ({ ...pair })) }));
    },
    getRecord(recordId: string): PairRecord | undefined {
      const found = records.get(recordId);
      return found === undefined
        ? undefined
        : { ...found, pairs: found.pairs.map((pair) => ({ ...pair })) };
    },
    getDataSource(dataSourceId: string): DataSourceEntry | undefined {
      const found = dataSources.get(dataSourceId);
      return found === undefined ? undefined : { ...found, content: { ...found.content } };
    },
    listDataSources(): DataSourceEntry[] {
      return [...dataSources.values()].map((entry) => ({ ...entry, content: { ...entry.content } }));
    },
    listRecords(): PairRecord[] {
      return [...records.values()].map((record) => ({
        ...record,
        pairs: record.pairs.map((pair) => ({ ...pair })),
      }));
    },
  };
}
