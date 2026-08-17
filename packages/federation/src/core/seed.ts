/**
 * federation — src/core/seed.ts
 * Duas fontes que não podem ser copiadas (phone + HR).
 */

import type { FederatedRowAcl } from 'contracts';

import { createFederationEngine, type FederationEngine } from './engine.js';
import { createMemoryFederatedConnector } from './memory-source.js';
import type { Clock, IdGenerator } from './determinism.js';

export const FED_SSN_SECRET = 'FED-SSN-SECRET';

const analystAcl: FederatedRowAcl = {
  entries: [
    { principal: 'alice', level: 'admin' },
    { principal: 'analysts', level: 'read' },
    { principal: 'public', level: 'read' },
  ],
  retrievedAt: '2024-06-01T12:00:00.000Z',
};

const hrAcl: FederatedRowAcl = {
  entries: [
    { principal: 'alice', level: 'admin' },
    { principal: 'analysts', level: 'read' },
  ],
  propertyEntries: {
    ssn: [{ principal: 'alice', level: 'admin' }],
  },
  retrievedAt: '2024-06-01T12:00:00.000Z',
};

export function seedFederation(opts: { clock?: Clock; nextId?: IdGenerator; ttlMs?: number } = {}): {
  engine: FederationEngine;
  phone: ReturnType<typeof createMemoryFederatedConnector>;
  hr: ReturnType<typeof createMemoryFederatedConnector>;
} {
  const phone = createMemoryFederatedConnector({
    connectorId: 'phone-fed',
    sourceSystem: 'phone-db',
    objectName: 'people_phones',
    records: [
      {
        objectId: 'P-778',
        fields: { id: 'P-778', name: 'Ada Lovelace', phone: '555-1234' },
        lastUpdated: '2024-06-01T11:59:00.000Z',
        acl: analystAcl,
      },
    ],
  });
  const hr = createMemoryFederatedConnector({
    connectorId: 'hr-fed',
    sourceSystem: 'hr-db',
    objectName: 'people_hr',
    records: [
      {
        objectId: 'P-778',
        fields: { id: 'P-778', email: 'ada@example.com', ssn: FED_SSN_SECRET },
        lastUpdated: '2024-06-01T11:59:30.000Z',
        acl: hrAcl,
      },
    ],
  });

  const engine = createFederationEngine(opts);
  engine.registerSource({
    catalog: {
      sourceId: 'phone-db',
      objectName: 'people_phones',
      objectTypeId: 'ot.person',
      fields: ['id', 'name', 'phone'],
    },
    connector: phone,
  });
  engine.registerSource({
    catalog: {
      sourceId: 'hr-db',
      objectName: 'people_hr',
      objectTypeId: 'ot.person',
      fields: ['id', 'email', 'ssn'],
    },
    connector: hr,
  });
  return { engine, phone, hr };
}
