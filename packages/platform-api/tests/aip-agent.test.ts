/**
 * platform-api — AIP agent propose → human approve → ActionExecutor (Passo 36).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('AIP agent run → Action approval', () => {
  afterEach(() => {
    delete process.env.PLATFORM_JWT_SECRET;
    delete process.env.PLATFORM_ENV;
    delete process.env.AIP_LLM_BASE_URL;
    delete process.env.AIP_LLM_API_KEY;
  });

  it('proposes requiring approval then manager approve executes via same ActionExecutor', async () => {
    process.env.PLATFORM_JWT_SECRET = SECRET;
    const ctx = createMemoryPlatformContext({
      policyFixture: 'allow-all',
    });

    const o = await ctx.ontology.createOntology({ name: 'agent-onto' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'note',
      displayName: 'Note',
      baseType: 'string',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.item',
      displayName: 'Item',
      propertyTypeIds: ['note'],
    });
    await ctx.ontology.addActionType(o.id, {
      id: 'act.createItem',
      apiName: 'createItem',
      displayName: 'Create Item',
      inputObjectTypeIds: ['ot.item'],
      requiresApproval: true,
      approvals: { required: true, approverPolicy: 'manager' },
      parameters: {
        id: { baseType: 'string', required: true },
        note: { baseType: 'string', required: false },
      },
      rules: [
        {
          kind: 'create_object',
          objectTypeId: 'ot.item',
          primaryKeyFromParam: 'id',
          propertiesFromParams: { note: 'note' },
        },
      ],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    const { app } = await createPlatformServer(ctx, {
      jwtSecret: SECRET,
      jwtIssuer: 'neumann',
    });

    const alice = signDevToken({
      secret: SECRET,
      principal: 'alice',
      issuer: 'neumann',
    });
    const manager = signDevToken({
      secret: SECRET,
      principal: 'manager',
      issuer: 'neumann',
    });

    const propose = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/aip/agent/run`,
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        message: 'Create item A1',
        proposedAction: {
          actionApiName: 'createItem',
          parameters: { id: 'A1', note: 'from-agent' },
          idempotencyKey: 'agent-a1',
        },
      },
    });
    expect(propose.statusCode).toBe(200);
    const body = propose.json() as {
      finalState: string;
      proposedExecutionId?: string;
      proposedActionStatus?: string;
    };
    expect(body.finalState).toBe('AWAITING_APPROVAL');
    expect(body.proposedExecutionId).toBeTruthy();
    expect(body.proposedActionStatus).toBe('AWAITING_APPROVAL');
    expect(await ctx.objects.get(o.id, 'ot.item', 'A1')).toBeUndefined();

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v2/actions/executions/${body.proposedExecutionId}/approve`,
      headers: { authorization: `Bearer ${manager}` },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('SUCCEEDED');
    expect((await ctx.objects.get(o.id, 'ot.item', 'A1'))?.properties.note).toBe('from-agent');

    await app.close();
  });
});
