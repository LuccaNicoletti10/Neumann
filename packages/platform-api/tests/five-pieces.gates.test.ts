/**
 * platform-api — tests/five-pieces.gates.test.ts
 * Gates das 5 peças (memória; integração PG usa os .integration existentes).
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createGovernedObjectRepository,
  createIdGenerator,
  createMemoryObjectHistoryStore,
  createMemoryObjectRepository,
  OntologyValidationError,
} from 'object-platform';
import { createOntologyAuthorizer } from 'policy-engine';
import type { OntologyVersion } from 'contracts';

const version: OntologyVersion = {
  id: 'v1', ontologyId: 'o1', versionNumber: 1, createdAt: '', createdBy: 't',
  contentHash: 'h', status: 'COMMITTED',
  objectTypes: {
    Titulo: { id: 'Titulo', displayName: 'Título', propertyTypeIds: ['valor', 'status'] },
  },
  propertyTypes: {
    valor:  { id: 'valor',  displayName: 'Valor',  baseType: 'number',
              validators: [{ kind: 'required' }] },
    status: { id: 'status', displayName: 'Status', baseType: 'string',
              validators: [{ kind: 'set', values: ['ABERTO', 'APROVADO', 'PAGO'] }] },
  },
  linkTypes: {}, actionTypes: {}, functionTypes: {},
};

function governed() {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  const objects = createGovernedObjectRepository({
    inner: createMemoryObjectRepository({ clock, nextId }),
    resolveVersion: async () => version,
    history,
    principal: () => 'fernanda',
    mode: 'enforce',
    versionCacheTtlMs: 0,
  });
  return { objects, history };
}

describe('PEÇA 1 — ontologia como lei', () => {
  it('rejeita object type não declarado', async () => {
    const { objects } = governed();
    await expect(
      objects.create({ ontologyId: 'o1', objectTypeId: 'Fantasma', primaryKey: 'x',
        properties: {} }),
    ).rejects.toThrow(OntologyValidationError);
  });

  it('rejeita propriedade fora do schema', async () => {
    const { objects } = governed();
    await expect(
      objects.create({ ontologyId: 'o1', objectTypeId: 'Titulo', primaryKey: 't1',
        properties: { valor: 100, campo_inventado: 1 } }),
    ).rejects.toThrow(/not declared/);
  });

  it('rejeita validator set violado e required ausente', async () => {
    const { objects } = governed();
    await expect(
      objects.create({ ontologyId: 'o1', objectTypeId: 'Titulo', primaryKey: 't1',
        properties: { valor: 100, status: 'INVALIDO' } }),
    ).rejects.toThrow(/not in/);
    await expect(
      objects.create({ ontologyId: 'o1', objectTypeId: 'Titulo', primaryKey: 't2',
        properties: { status: 'ABERTO' } }),
    ).rejects.toThrow(/required/);
  });

  it('aceita escrita válida', async () => {
    const { objects } = governed();
    const o = await objects.create({ ontologyId: 'o1', objectTypeId: 'Titulo',
      primaryKey: 't1', properties: { valor: 100, status: 'ABERTO' } });
    expect(o.primaryKey).toBe('t1');
  });
});

describe('PEÇA 3 — histórico pós-mutação e asOf', () => {
  it('grava create + POST-state do update; asOf(agora) = get()', async () => {
    const { objects, history } = governed();
    const o = await objects.create({ ontologyId: 'o1', objectTypeId: 'Titulo',
      primaryKey: 't1', properties: { valor: 100, status: 'ABERTO' } });
    const updated = await objects.update('o1', 'Titulo', 't1',
      { properties: { status: 'APROVADO' } });

    const trail = await history.listByObject(o.id);
    expect(trail.length).toBe(2);
    expect(trail[0]!.operation).toBe('create');
    expect(trail[1]!.operation).toBe('update');
    expect(trail[1]!.properties.status).toBe('APROVADO');
    expect(trail[1]!.version).toBe(updated.version);
    expect(trail[1]!.principal).toBe('fernanda');
    const asOfCreate = await history.asOf('o1', 'Titulo', 't1', trail[0]!.createdAt);
    expect(asOfCreate?.properties.status).toBe('ABERTO');
    const asOfNow = await history.asOf('o1', 'Titulo', 't1', trail[1]!.createdAt);
    expect(asOfNow?.properties.status).toBe('APROVADO');
    expect(asOfNow?.version).toBe(updated.version);
  });

  it('delete snapshot marca deleted=true a partir do post-state real', async () => {
    const { objects, history } = governed();
    const o = await objects.create({ ontologyId: 'o1', objectTypeId: 'Titulo',
      primaryKey: 't1', properties: { valor: 100, status: 'ABERTO' } });
    const post = await objects.delete('o1', 'Titulo', 't1');
    expect(post?.deleted).toBe(true);
    expect(post?.version).toBe(o.version + 1);
    const trail = await history.listByObject(o.id);
    const del = trail[trail.length - 1]!;
    expect(del.operation).toBe('delete');
    expect(del.deleted).toBe(true);
    expect(del.version).toBe(post!.version);
    expect(del.properties.status).toBe('ABERTO');
  });
});

describe('PEÇA 4 — authorizer declarativo', () => {
  const authz = createOntologyAuthorizer({
    roles: { fernanda: ['financeiro'], intruso: [] },
    grants: [
      { role: 'financeiro', actions: ['AprovarTitulo'],
        objectTypes: ['Titulo'], operations: ['read', 'modify'],
        hiddenProperties: ['margem_interna'] },
    ],
  });

  it('allow/deny por action e objectType', () => {
    expect(authz.canRunAction('fernanda', 'AprovarTitulo')).toBe(true);
    expect(authz.canRunAction('fernanda', 'ExcluirTudo')).toBe(false);
    expect(authz.canReadObjectType('fernanda', 'Titulo')).toBe(true);
    expect(authz.canReadObjectType('intruso', 'Titulo')).toBe(false);
    expect(authz.authorize({ principal: 'intruso', resource: 'action:AprovarTitulo',
      operation: 'modify' }).decision).toBe('deny');
  });

  it('redação de propriedade', () => {
    const out = authz.redactProperties('fernanda', 'Titulo',
      { valor: 100, margem_interna: 0.3 });
    expect(out.valor).toBe(100);
    expect('margem_interna' in out).toBe(false);
  });
});

describe('PEÇA 2 — write-guard HTTP', () => {
  it('POST /objects as humano returns 403 ActionsOnlyWritePath', async () => {
    const { createPlatformServer } = await import('../src/server.js');
    const { createMemoryPlatformContext } = await import('../src/core/context.js');
    const ctx = createMemoryPlatformContext();
    const o = await ctx.ontology.createOntology({ name: 'guard' });
    const { app } = await createPlatformServer(ctx);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing`,
      headers: { authorization: 'Bearer lucca' },
      payload: { primaryKey: '1', properties: { n: 1 } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().errorName).toBe('ActionsOnlyWritePath');
    await app.close();
  });
});
