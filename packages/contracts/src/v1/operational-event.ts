/**
 * contracts — src/v1/operational-event.ts
 * Lightweight operational events (not full event sourcing).
 */

import type { ActionTypeId, LinkTypeId, ObjectTypeId, OntologyId } from './ontology.js';
import type { LinkRecordId, ObjectRecordId } from './object-repository.js';
import type { PrincipalId } from './policy.js';

export type OperationalEventId = string;

export type OperationalEventKind =
  | 'ObjectCreated'
  | 'ObjectModified'
  | 'ObjectDeleted'
  | 'LinkCreated'
  | 'LinkDeleted'
  | 'ActionApplied'
  | 'ActionDenied'
  | 'ActionFailed'
  | 'ApprovalRequested'
  | 'ApprovalDecided'
  | 'ExternalWritebackRequested'
  | 'ExternalWritebackSucceeded'
  | 'ExternalWritebackFailed';

export interface OperationalEvent {
  id: OperationalEventId;
  kind: OperationalEventKind;
  at: string;
  ontologyId?: OntologyId;
  principal?: PrincipalId;
  objectId?: ObjectRecordId;
  objectTypeId?: ObjectTypeId;
  primaryKey?: string;
  linkId?: LinkRecordId;
  linkTypeId?: LinkTypeId;
  actionTypeId?: ActionTypeId;
  actionExecutionId?: string;
  payload?: Record<string, unknown>;
}

export interface OperationalEventStore {
  append(
    event: Omit<OperationalEvent, 'id' | 'at'> & { id?: string; at?: string },
  ): Promise<OperationalEvent>;
  list(filter?: {
    ontologyId?: OntologyId;
    kind?: OperationalEventKind;
    objectId?: ObjectRecordId;
    limit?: number;
  }): Promise<OperationalEvent[]>;
}
