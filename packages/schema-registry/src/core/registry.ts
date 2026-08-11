/**
 * schema-registry — src/core/registry.ts
 * Registro de source/object/column/tipo/hints/keys/first_seen/last_seen + versão.
 */

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { classifyDrift } from './drift.js';
import type {
  Clock,
  ColumnSchema,
  DriftReport,
  IdGenerator,
  ObservedColumn,
  ObservedSchema,
  ObjectSchema,
  SchemaAlert,
  TypeCast,
} from './types.js';
import { CoreError } from './types.js';

export interface RegistryDeps {
  clock?: Clock;
  nextId?: IdGenerator;
}

export interface RegisterResult {
  schema: ObjectSchema;
  created: boolean;
}

export interface ObserveResult {
  report: DriftReport;
  schema: ObjectSchema;
  alert?: SchemaAlert;
}

function keyOf(source: string, object: string): string {
  return `${source}::${object}`;
}

function toColumnSchema(
  col: ObservedColumn,
  at: string,
  previous?: ColumnSchema,
): ColumnSchema {
  const base: ColumnSchema = {
    column: col.column,
    physicalType: col.physicalType,
    nullable: col.nullable,
    isPrimaryKey: col.isPrimaryKey ?? false,
    foreignKeys: [...(col.foreignKeys ?? [])],
    observedValuesSample: [...(col.sampleValues ?? [])].slice(0, 10).map(String),
    firstSeen: previous?.firstSeen ?? at,
    lastSeen: at,
  };
  if (col.semanticHint !== undefined) {
    base.semanticHint = col.semanticHint;
  } else if (previous?.semanticHint !== undefined) {
    base.semanticHint = previous.semanticHint;
  }
  return base;
}

/** Schema Registry em memória (determinístico). */
export interface SchemaRegistry {
  /** Registra (ou substitui) o schema inicial de um objeto. */
  register(observed: ObservedSchema): RegisterResult;
  /** Observa um schema novo: classifica drift e aplica a resposta definida. */
  observe(observed: ObservedSchema): ObserveResult;
  get(source: string, object: string): ObjectSchema | undefined;
  list(source?: string): ObjectSchema[];
  listCasts(source: string, object: string): TypeCast[];
  listAlerts(opts?: { acknowledged?: boolean }): SchemaAlert[];
  acknowledgeAlert(alertId: string): SchemaAlert;
  /** Reativa uma fonte pausada (após revisão humana). */
  resume(source: string, object: string): ObjectSchema;
  isPaused(source: string, object: string): boolean;
}

export function createSchemaRegistry(deps: RegistryDeps = {}): SchemaRegistry {
  const clock = deps.clock ?? createDeterministicClock();
  const nextId = deps.nextId ?? createIdGenerator();
  const schemas = new Map<string, ObjectSchema>();
  const castsByKey = new Map<string, TypeCast[]>();
  const alerts: SchemaAlert[] = [];

  function requireSchema(source: string, object: string): ObjectSchema {
    const schema = schemas.get(keyOf(source, object));
    if (schema === undefined) {
      throw new CoreError(
        'SCHEMA_NOT_FOUND',
        `schema não registrado: ${source}.${object}`,
      );
    }
    return schema;
  }

  function cloneSchema(schema: ObjectSchema): ObjectSchema {
    return {
      ...schema,
      columns: schema.columns.map((c) => ({
        ...c,
        foreignKeys: [...c.foreignKeys],
        observedValuesSample: [...c.observedValuesSample],
      })),
    };
  }

  return {
    register(observed: ObservedSchema): RegisterResult {
      if (observed.source.trim() === '' || observed.object.trim() === '') {
        throw new CoreError('INVALID_SCHEMA', 'source e object são obrigatórios');
      }
      if (observed.columns.length === 0) {
        throw new CoreError('INVALID_SCHEMA', 'schema precisa de ao menos uma coluna');
      }
      const at = observed.observedAt ?? clock();
      const key = keyOf(observed.source, observed.object);
      const existing = schemas.get(key);
      const schema: ObjectSchema = {
        source: observed.source,
        object: observed.object,
        schemaVersion: existing ? existing.schemaVersion + 1 : 1,
        columns: observed.columns
          .map((c) => toColumnSchema(c, at))
          .sort((a, b) => a.column.localeCompare(b.column)),
        paused: false,
        updatedAt: at,
      };
      schemas.set(key, schema);
      return { schema: cloneSchema(schema), created: existing === undefined };
    },

    observe(observed: ObservedSchema): ObserveResult {
      const registered = requireSchema(observed.source, observed.object);
      if (registered.paused) {
        throw new CoreError(
          'SOURCE_PAUSED',
          `fonte pausada por drift anterior: ${observed.source}.${observed.object}` +
            (registered.pauseReason ? ` (${registered.pauseReason})` : ''),
        );
      }

      const report = classifyDrift(registered, observed, { clock });
      const key = keyOf(observed.source, observed.object);
      const at = report.at;

      if (report.action === 'pause_and_alert') {
        const alert: SchemaAlert = {
          id: nextId('alert'),
          source: observed.source,
          object: observed.object,
          kind: report.kind,
          detail: report.detail,
          changes: report.changes.filter((c) => c.kind !== 'unchanged'),
          at,
          acknowledged: false,
        };
        alerts.push(alert);
        const paused: ObjectSchema = {
          ...registered,
          paused: true,
          pauseReason: report.detail,
          updatedAt: at,
        };
        schemas.set(key, paused);
        return { report, schema: cloneSchema(paused), alert };
      }

      // accept / accept_with_cast → novo schema_version
      const prevByName = new Map(registered.columns.map((c) => [c.column, c]));
      const nextColumns = observed.columns
        .map((c) => toColumnSchema(c, at, prevByName.get(c.column)))
        .sort((a, b) => a.column.localeCompare(b.column));

      // Preserve columns that are unchanged-only path: merge semantic hints etc.
      // Observed is source of truth for structure after compatible/coercible.
      const next: ObjectSchema = {
        source: registered.source,
        object: registered.object,
        schemaVersion: registered.schemaVersion + 1,
        columns: nextColumns,
        paused: false,
        updatedAt: at,
      };
      schemas.set(key, next);

      if (report.action === 'accept_with_cast' && report.casts.length > 0) {
        const existingCasts = castsByKey.get(key) ?? [];
        castsByKey.set(key, [...existingCasts, ...report.casts]);
      }

      return { report, schema: cloneSchema(next) };
    },

    get(source: string, object: string): ObjectSchema | undefined {
      const schema = schemas.get(keyOf(source, object));
      return schema === undefined ? undefined : cloneSchema(schema);
    },

    list(source?: string): ObjectSchema[] {
      return [...schemas.values()]
        .filter((s) => source === undefined || s.source === source)
        .sort((a, b) => a.source.localeCompare(b.source) || a.object.localeCompare(b.object))
        .map(cloneSchema);
    },

    listCasts(source: string, object: string): TypeCast[] {
      return [...(castsByKey.get(keyOf(source, object)) ?? [])];
    },

    listAlerts(opts: { acknowledged?: boolean } = {}): SchemaAlert[] {
      return alerts
        .filter((a) => opts.acknowledged === undefined || a.acknowledged === opts.acknowledged)
        .map((a) => ({ ...a, changes: a.changes.map((c) => ({ ...c })) }));
    },

    acknowledgeAlert(alertId: string): SchemaAlert {
      const alert = alerts.find((a) => a.id === alertId);
      if (alert === undefined) {
        throw new CoreError('ALERT_NOT_FOUND', `alerta não encontrado: ${alertId}`);
      }
      alert.acknowledged = true;
      return { ...alert, changes: alert.changes.map((c) => ({ ...c })) };
    },

    resume(source: string, object: string): ObjectSchema {
      const schema = requireSchema(source, object);
      const resumed: ObjectSchema = {
        ...schema,
        paused: false,
        updatedAt: clock(),
      };
      delete resumed.pauseReason;
      schemas.set(keyOf(source, object), resumed);
      return cloneSchema(resumed);
    },

    isPaused(source: string, object: string): boolean {
      return schemas.get(keyOf(source, object))?.paused ?? false;
    },
  };
}
