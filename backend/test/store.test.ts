import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isValidGstin } from '../src/lib/gst.js';
import { DESIGN_ITEMS, setupTestApp, type TestCtx } from './helpers.js';

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

/** Builds a GSTIN with a valid check digit for the given state code and PAN. */
function makeGstin(state: string, pan: string) {
  const base = `${state}${pan}1Z`;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const c of chars) if (isValidGstin(base + c)) return base + c;
  throw new Error('no check digit');
}

describe('onboarding (design screens 4a–4f)', () => {
  it('walks through every step', async () => {
    const { accessToken: token } = await t.signIn();

    // Shop endpoints need a store first
    const early = await t.inject('GET', '/api/v1/items', token);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('STORE_NOT_SET_UP');

    // 4b · Shop details
    const created = await t.inject('POST', '/api/v1/store', token, {
      name: 'Sharma Kirana Store',
      ownerName: 'Rajesh Sharma',
      city: 'Sitapur',
      givesCredit: true,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().onboarding.steps).toEqual({ number: true, shop: true, language: false, items: false });
    expect((await t.inject('POST', '/api/v1/store', token, { name: 'X', ownerName: 'Y', city: 'Z' })).statusCode).toBe(409);
    expect((await t.inject('GET', '/api/v1/auth/me', token)).json().user.name).toBe('Rajesh Sharma');

    const early2 = await t.inject('POST', '/api/v1/store/onboarding/complete', token);
    expect(early2.statusCode).toBe(400);
    expect(early2.json().error.details.missing).toEqual(['language', 'items']);

    // 4c · GST & PAN (optional)
    const gstin = makeGstin('09', 'ABCDE1234F');
    const noScheme = await t.inject('PUT', '/api/v1/store/tax', token, { gstin });
    expect(noScheme.statusCode).toBe(400);
    expect(noScheme.json().error.details).toEqual({ field: 'gstScheme' });
    const tax = await t.inject('PUT', '/api/v1/store/tax', token, {
      gstin: gstin.toLowerCase(),
      gstScheme: 'regular',
      legalName: 'Rajesh Sharma',
    });
    expect(tax.statusCode).toBe(200);
    expect(tax.json().store).toMatchObject({ gstin, gstScheme: 'regular', pan: 'ABCDE1234F', state: 'Uttar Pradesh', legalName: 'Rajesh Sharma' });
    const badGst = await t.inject('PUT', '/api/v1/store/tax', token, { gstin: gstin.slice(0, 14) + (gstin[14] === 'A' ? 'B' : 'A') });
    expect(badGst.statusCode).toBe(400);
    const mismatch = await t.inject('PUT', '/api/v1/store/tax', token, { gstin, pan: 'ZZZZZ9999Z' });
    expect(mismatch.statusCode).toBe(400);
    const panOnly = await t.inject('PUT', '/api/v1/store/tax', token, { gstin: null, pan: 'abcde1234f' });
    expect(panOnly.json().store).toMatchObject({ gstin: null, gstScheme: null, pan: 'ABCDE1234F' });

    // 4d · Language & reply style
    const prefs = await t.inject('PUT', '/api/v1/store/preferences', token, { language: 'hi', replyStyle: 'text' });
    expect(prefs.json().store).toMatchObject({ language: 'hi', replyStyle: 'text' });

    // 4e · Items
    const bulk = await t.inject('POST', '/api/v1/items/bulk', token, {
      items: [...DESIGN_ITEMS.slice(0, 2), { name: 'Sarson tel', unit: 'l', unitSize: 1, price: null, stock: 10 }],
    });
    expect(bulk.statusCode).toBe(201);
    expect(bulk.json().missingPrice).toBe(1);
    expect(bulk.json().data.map((i: { displayName: string }) => i.displayName)).toEqual(['Atta 5 kg', 'Toor dal 1 kg', 'Sarson tel 1 L']);

    // Re-uploading the same variant updates it instead of duplicating
    await t.inject('POST', '/api/v1/items/bulk', token, { items: [{ name: 'sarson tel', unit: 'l', unitSize: 1, price: 170, stock: 8 }] });
    const list = (await t.inject('GET', '/api/v1/items', token)).json().data;
    expect(list).toHaveLength(3);
    expect(list.find((i: { name: string }) => i.name === 'Sarson tel')).toMatchObject({ price: 17000, stock: 8 });

    // 4f · Done
    const done = await t.inject('POST', '/api/v1/store/onboarding/complete', token);
    expect(done.statusCode).toBe(200);
    expect(done.json().onboarding).toMatchObject({ completed: true, itemCount: 3 });
  });
});

describe('items', () => {
  it('CRUD, duplicate check, stock adjustments and low-stock list', async () => {
    const { token, item } = await t.shop();
    const dup = await t.inject('POST', '/api/v1/items', token, { name: 'ATTA', unit: 'kg', unitSize: 5, price: 250 });
    expect(dup.statusCode).toBe(409);

    const cheeni = item('Cheeni 1 kg');
    const low = (await t.inject('GET', '/api/v1/items/low-stock', token)).json().data;
    expect(low.map((i: { displayName: string }) => i.displayName)).toEqual(['Cheeni 1 kg']);

    const restock = await t.inject('POST', `/api/v1/items/${cheeni.id}/stock`, token, { delta: 20 });
    expect(restock.json().item.stock).toBe(23);
    expect((await t.inject('GET', '/api/v1/items/low-stock', token)).json().data).toHaveLength(0);

    const patched = await t.inject('PATCH', `/api/v1/items/${cheeni.id}`, token, { price: 47.5 });
    expect(patched.json().item.price).toBe(4750);

    expect((await t.inject('DELETE', `/api/v1/items/${cheeni.id}`, token)).statusCode).toBe(204);
    const search = (await t.inject('GET', '/api/v1/items?search=chee', token)).json().data;
    expect(search).toHaveLength(0);
    const alias = (await t.inject('GET', '/api/v1/items?search=mustard', token)).json().data;
    expect(alias.map((i: { displayName: string }) => i.displayName)).toEqual(['Sarson tel 1 L', 'Sarson tel 500 ml']);
  });

  it('shops cannot see each other’s data', async () => {
    const a = await t.shop('9876543450');
    const b = await t.shop('9876543451');
    const atta = a.item('Atta 5 kg');
    expect((await t.inject('GET', `/api/v1/items/${atta.id}`, b.token)).statusCode).toBe(404);
    expect((await t.inject('PATCH', `/api/v1/items/${atta.id}`, b.token, { price: 1 })).statusCode).toBe(404);
  });
});
