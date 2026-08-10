/**
 * Tipos centrais do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "periodic search" — usuários especificam buscas (queries) que
 * rodam PERIODICAMENTE sobre MÚLTIPLAS fontes de dados ("multiple data sources"),
 * com detecção de dados novos ("new-data detection"), alerta/notificação a
 * usuários e times ("alert/notify") e armazenamento de resultados
 * ("result storage"). Este arquivo define as estruturas de dados compartilhadas.
 */

/** Especificação da query executada contra uma fonte de dados. */
export interface QuerySpec {
  /** Texto livre buscado no conteúdo do registro (case-insensitive). */
  text?: string | undefined;
  /** Filtros exatos por chave do conteúdo do registro. */
  filters?: Record<string, string | number | boolean> | undefined;
  /** Limite máximo de registros retornados por execução/fonte. */
  limit?: number | undefined;
}

/** Especificação do agendamento periódico de uma busca. */
export type ScheduleSpec =
  | { kind: 'interval'; everyMs: number }
  | { kind: 'daily'; hourUtc: number; minuteUtc: number };

/**
 * Configuração de uma busca periódica: quais fontes consultar, com qual query,
 * em qual agenda e para quem notificar.
 */
export interface SearchConfig {
  id: string;
  name: string;
  query: QuerySpec;
  dataSourceIds: string[];
  schedule: ScheduleSpec;
  /** Usuários individuais destinatários dos alertas. */
  recipientUserIds: string[];
  /** Times cujos membros também recebem os alertas. */
  teamIds: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

/** Registro de um alerta gerado quando surgem resultados novos. */
export interface AlertRecord {
  id: string;
  searchId: string;
  searchName: string;
  /** IDs de fontes que contribuíram com registros novos. */
  sourceIds: string[];
  /** Quantidade total de registros novos. */
  newRecordCount: number;
  /** Amostra (até N) dos registros novos. */
  sampleRecords: SampleRecord[];
  /** Destinatários efetivos (usuários da busca + membros dos times, deduplicados). */
  recipientUserIds: string[];
  /** Mensagem legível por humano. */
  message: string;
  createdAt: string;
}

/** Resumo de um registro incluído na amostra de um alerta. */
export interface SampleRecord {
  recordId: string;
  sourceId: string;
  timestamp: string;
  preview: string;
}

/** Registro de resultado de busca persistido (result storage). */
export interface SearchResultRecord {
  searchId: string;
  recordId: string;
  sourceId: string;
  timestamp: string;
  /** Hash sha256 do conteúdo — base da detecção de alterações. */
  contentHash: string;
  content: Record<string, unknown>;
  firstSeenAt: string;
  runId: string;
}

/** Registro de uma execução (run) de uma busca periódica. */
export interface RunRecord {
  id: string;
  searchId: string;
  startedAt: string;
  finishedAt: string;
  /** Contagem de registros retornados por fonte (após filtro do watermark). */
  fetchedBySource: Record<string, number>;
  /** Contagem de registros realmente novos por fonte (após o diff). */
  newBySource: Record<string, number>;
  totalFetched: number;
  totalNew: number;
  alertId?: string;
  status: 'ok' | 'error';
  error?: string;
}

/** Relógio injetável: garante determinismo nos testes e no agendador. */
export interface Clock {
  now(): Date;
}