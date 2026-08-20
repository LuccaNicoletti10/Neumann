/**
 * action-engine — src/core/events.ts
 * In-memory OperationalEventStore (tests/demos only).
 */

import type { OperationalEvent, OperationalEventStore } from 'contracts';
import type { MemoryCheckpoint } from 'object-platform';
import { restoreArray } from 'object-platform';

import type { Clock, IdGenerator } from './types.js';

export function createMemoryOperationalEventStore(opts: {
  clock: Clock;
  nextId: IdGenerator;
}): OperationalEventStore & MemoryCheckpoint {
  const events: OperationalEvent[] = [];

  return {
    async append(partial) {
      const event: OperationalEvent = {
        id: partial.id ?? opts.nextId('opev'),
        at: partial.at ?? opts.clock(),
        kind: partial.kind,
        ontologyId: partial.ontologyId,
        principal: partial.principal,
        objectId: partial.objectId,
        objectTypeId: partial.objectTypeId,
        primaryKey: partial.primaryKey,
        linkId: partial.linkId,
        linkTypeId: partial.linkTypeId,
        actionTypeId: partial.actionTypeId,
        actionExecutionId: partial.actionExecutionId,
        payload: partial.payload,
      };
      events.push(event);
      return event;
    },
    async list(filter) {
      let out = [...events];
      if (filter?.ontologyId) {
        out = out.filter((e) => e.ontologyId === filter.ontologyId);
      }
      if (filter?.kind) {
        out = out.filter((e) => e.kind === filter.kind);
      }
      if (filter?.objectId) {
        out = out.filter((e) => e.objectId === filter.objectId);
      }
      if (filter?.limit != null) out = out.slice(-filter.limit);
      return out;
    },
    capture() {
      return events.map((e) => ({ ...e }));
    },
    restore(snapshot: unknown) {
      restoreArray(events, snapshot as OperationalEvent[]);
    },
  };
}
