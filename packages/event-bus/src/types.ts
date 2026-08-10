export interface OutboxRecord {
  eventId: string;
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  createdAt: string;
  publishedAt?: string;
  attempts: number;
}

export interface CanonicalEvent {
  event_id: string;
  source_system: string;
  source_object: string;
  source_primary_key: string;
  schema_version: string;
  occurred_at: string;
  ingested_at: string;
  connector_id: string;
  checkpoint: string | null;
  principal: string;
  policy_tags: string[];
  payload_hash: string;
  payload: Record<string, unknown>;
}

export interface Clock {
  now(): number;
  advance?(ms: number): void;
}

export class FakeClock implements Clock {
  private t: number;

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) throw new Error('FakeClock.advance: ms must be non-negative');
    this.t += ms;
  }
}

export function toCanonicalEvent(record: OutboxRecord): CanonicalEvent {
  const [sourceSystem, sourcePrimaryKey] = parseKey(record.key);
  return {
    event_id: record.eventId,
    source_system: sourceSystem,
    source_object: record.topic,
    source_primary_key: sourcePrimaryKey,
    schema_version: '1.0',
    occurred_at: record.createdAt,
    ingested_at: record.createdAt,
    connector_id: 'event-bus',
    checkpoint: null,
    principal: record.principal,
    policy_tags: [],
    payload_hash: hashPayload(record.payload),
    payload: record.payload,
  };
}

function parseKey(key: string): [string, string] {
  const idx = key.indexOf('+');
  if (idx === -1) return [key, key];
  return [key.slice(0, idx), key.slice(idx + 1)];
}

function hashPayload(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  let h = 0;
  for (let i = 0; i < json.length; i += 1) {
    h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}
