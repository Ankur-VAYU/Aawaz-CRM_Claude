import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestCtx } from './helpers.js';

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestApp();
});
beforeEach(async () => {
  await t.reset();
});
afterAll(async () => {
  await t.close();
});

describe('inventory in ("maal aaya")', () => {
  it('voice preview matches items without changing stock; receiving adds stock and keeps history', async () => {
    const { token, item } = await t.shop();
    const res = await t.say(token, 'Gupta Traders se maal aaya: 20 bag atta, 10 sarson tel 1 litre, do sabun');
    expect(res.intent).toBe('stock_in');
    expect(res.stockIn.supplier).toBe('Gupta Traders');
    expect(res.stockIn.matched.map((m: { displayName: string; quantity: number }) => [m.displayName, m.quantity])).toEqual([
      ['Atta 5 kg', 20],
      ['Sarson tel 1 L', 10],
    ]);
    expect(res.stockIn.unmatched).toHaveLength(1);
    expect((await t.inject('GET', `/api/v1/items/${item('Atta 5 kg').id}`, token)).json().item.stock).toBe(24);

    const body = {
      supplier: 'Gupta Traders',
      clientId: 'phone-1-stock-0001',
      lines: [
        { itemId: item('Atta 5 kg').id, quantity: 20, costPrice: 220 },
        { itemId: item('Sarson tel 1 L').id, quantity: 10 },
      ],
    };
    const r = await t.inject('POST', '/api/v1/items/receive', token, body);
    expect(r.statusCode).toBe(201);
    expect(r.json().receipt).toMatchObject({ supplier: 'Gupta Traders', totalCost: 440000 });
    expect(r.json().receipt.items.map((l: { displayName: string; stockNow: number }) => [l.displayName, l.stockNow])).toEqual(
      expect.arrayContaining([
        ['Atta 5 kg', 44],
        ['Sarson tel 1 L', 20],
      ]),
    );

    // Retried from a phone on a weak network: recorded once
    const again = await t.inject('POST', '/api/v1/items/receive', token, body);
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect((await t.inject('GET', `/api/v1/items/${item('Atta 5 kg').id}`, token)).json().item.stock).toBe(44);

    const list = (await t.inject('GET', '/api/v1/items/receipts', token)).json().data;
    expect(list).toHaveLength(1);
    expect(list[0].items).toHaveLength(2);
  });

  it('refuses items from another shop', async () => {
    const a = await t.shop('9876543450');
    const b = await t.shop('9876543451');
    const r = await t.inject('POST', '/api/v1/items/receive', b.token, { lines: [{ itemId: a.item('Atta 5 kg').id, quantity: 1 }] });
    expect(r.statusCode).toBe(400);
  });
});
