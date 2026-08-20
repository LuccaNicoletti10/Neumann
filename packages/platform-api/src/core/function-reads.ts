/**
 * platform-api — Function reads (ADR-0020).
 * Historical snapshot only. Live rows are not on this path.
 */

import type { FunctionObjectInput } from 'contracts';
import type { FunctionObjectReader } from 'function-registry';
import { FunctionSnapshotUnavailableError } from 'function-registry';
import type { ObjectHistoryStore } from 'object-platform';
import type { PolicyRuntime } from 'policy-engine';

export function createFunctionObjectReader(
  policy: PolicyRuntime,
  history: ObjectHistoryStore,
): FunctionObjectReader {
  return {
    async currentSeq() {
      const mark = await history.watermark();
      return mark.seq;
    },
    async getObject(principal, ontologyId, objectTypeId, primaryKey, readAsOf, readSeq) {
      if (!policy.canReadObjectType(principal, objectTypeId, ontologyId)) return undefined;
      const entry = await history.asOf(ontologyId, objectTypeId, primaryKey, readAsOf, readSeq);
      // WHY: a deleted or missing asOf row is not the live object; fail closed.
      if (!entry || entry.deleted) throw new FunctionSnapshotUnavailableError();
      return {
        objectTypeId: entry.objectTypeId,
        primaryKey: entry.primaryKey,
        properties: policy.redactProperties(
          principal,
          objectTypeId,
          entry.properties,
          ontologyId,
        ) as Record<string, unknown>,
      } satisfies FunctionObjectInput;
    },
  };
}
