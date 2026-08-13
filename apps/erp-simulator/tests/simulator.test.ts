import { afterAll, describe, expect, it } from 'vitest';

import { listenErpSimulator } from '../src/server.js';

describe('erp simulator', () => {
  let url = '';
  let close: () => Promise<void> = async () => {};

  afterAll(async () => {
    await close();
  });

  it('CRUD + idempotency + 500 fault', async () => {
    const sim = await listenErpSimulator({
      seed: (s) => {
        s.orders.set('O1', { id: 'O1', status: 'pending' });
        s.inventory.set('SKU1', { sku: 'SKU1', quantity: 4 });
        s.suppliers.set('S1', { id: 'S1', name: 'Acme', status: 'ok' });
      },
    });
    url = sim.url;
    close = () => sim.app.close();

    const created = await fetch(`${url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ id: 'O2', status: 'open' }),
    });
    expect(created.status).toBe(201);
    const replay = await fetch(`${url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ id: 'O2', status: 'open' }),
    });
    expect(replay.status).toBe(201);
    expect((await sim.app.inject({ method: 'GET', url: '/orders' })).json().data).toHaveLength(2);

    const patched = await fetch(`${url}/orders/O1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    });
    expect(((await patched.json()) as { status: string }).status).toBe('ok');

    const inv = await fetch(`${url}/inventory/SKU1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 9 }),
    });
    expect(((await inv.json()) as { quantity: number }).quantity).toBe(9);
    expect(
      ((await (await fetch(`${url}/suppliers`)).json()) as { data: unknown[] }).data,
    ).toHaveLength(1);

    const boom = await fetch(`${url}/orders/O1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-simulate-fault': '500' },
      body: JSON.stringify({ status: 'nope' }),
    });
    expect(boom.status).toBe(500);
  });
});
