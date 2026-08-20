/**
 * ProjectionWriter: only allow mutates; partial writes zero effects.
 */
import { describe, expect, it } from 'vitest';

import type { AuthzDecision, AuthorizeFn, AuthorizeResult, OperationalEventStore, OutboxRepository } from 'contracts';

import { ProjectionDeniedError } from '../src/core/errors.js';
import { createDeterministicClock } from '../src/core/determinism.js';
import { createGovernedObjectRepository } from '../src/core/governed-object-repository.js';
import { createMemoryLinkRepository } from '../src/core/link-repository.js';
import { createMemoryObjectHistoryStore } from '../src/core/object-history-store.js';
import { createMemoryObjectRepository } from '../src/core/object-repository.js';
import { createMemoryProjectionLedger } from '../src/core/projection-ledger.js';
import { createProjectionWriter, type ProjectionStores } from '../src/core/projection-writer.js';
import { fixtureOntologyVersion, fixtureVersionPolicy } from './version-policy-fixture.js';

function decision(d: AuthzDecision): AuthorizeResult {
  return {
    decision: d,
    principalEpids: d === 'deny' ? [] : ['e'],
    resourceEpid: d === 'deny' ? null : 'e',
    reason: d,
  };
}

describe('ProjectionWriter authorize matrix', () => {
  it('deny and partial produce zero object/link/history/event writes; allow applies', async () => {
    for (const d of ['deny', 'partial', 'allow'] as const) {
      const clock = createDeterministicClock();
      const raw = createMemoryObjectRepository({ clock });
      const history = createMemoryObjectHistoryStore({ clock });
      const objects = createGovernedObjectRepository({
        inner: raw,
        versionPolicy: fixtureVersionPolicy(
          fixtureOntologyVersion({ objectTypes: { 'ot.order': ['status'] } }),
        ),
        history,
        mode: 'enforce',
      });
      const links = createMemoryLinkRepository({ clock });
      const events: unknown[] = [];
      const outbox: unknown[] = [];
      const ledger = createMemoryProjectionLedger();
      const eventStore = {
        async append(event: Record<string, unknown>) {
          events.push(event);
          return { id: 'e', at: 't', ...event };
        },
        async list() {
          return [];
        },
      };
      const outboxStore = {
        async insert(input: unknown) {
          outbox.push(input);
        },
      };
      const authorize: AuthorizeFn = () => decision(d);
      const stores: ProjectionStores = {
        objects,
        links,
        events: eventStore as unknown as OperationalEventStore,
        ledger,
        outbox: outboxStore as unknown as OutboxRepository,
      };
      const writer = createProjectionWriter({
        ...stores,
        authorize,
        resourceId: 'admin:projection',
        clock,
        unitOfWork: { run: (fn) => fn(stores) },
      });
      const cmd = {
        ontologyId: 'o1',
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'pending' },
        source: 'erp',
        sourceEventId: `e-${d}`,
        principal: 'svc',
      };
      if (d === 'allow') {
        const r = await writer.projectObject(cmd);
        expect(r.status).toBe('applied');
        expect(await objects.get('o1', 'ot.order', '1')).toBeTruthy();
        expect(events).toHaveLength(1);
        expect(outbox).toHaveLength(1);
        expect(await history.listByObject(r.object!.id)).toHaveLength(1);
      } else {
        await expect(writer.projectObject(cmd)).rejects.toBeInstanceOf(ProjectionDeniedError);
        expect(await objects.get('o1', 'ot.order', '1')).toBeUndefined();
        expect(events).toHaveLength(0);
        expect(outbox).toHaveLength(0);
        expect(await history.asOf('o1', 'ot.order', '1', '9999-01-01T00:00:00.000Z')).toBeUndefined();
      }
    }
  });
});
