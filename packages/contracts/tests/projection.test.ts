/**
 * contracts — ProjectionWriter is a typed command port, not ActionExecution.
 */
import { describe, expect, it } from 'vitest';

import type { ProjectObjectCommand, ProjectionWriter } from '../src/v1/projection.js';

describe('projection contracts', () => {
  it('identity is source + ontology + sourceEventId', () => {
    const cmd: ProjectObjectCommand = {
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'evt-1',
      principal: 'svc',
    };
    expect(cmd.sourceEventId).toBe('evt-1');
    const writer: Pick<ProjectionWriter, 'projectObject'> = {
      projectObject: async (c) => ({
        status: 'applied',
        operation: 'project_object',
        source: c.source,
        sourceEventId: c.sourceEventId,
        ontologyId: c.ontologyId,
      }),
    };
    expect(writer.projectObject).toBeTypeOf('function');
  });
});
