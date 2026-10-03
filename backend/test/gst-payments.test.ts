import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { financialYear, isValidGstin } from '../src/lib/gst.js';
import { localDate } from '../src/lib/time.js';
import { deliverPendingMessages } from '../src/messaging/workers.js';
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

const silentLog = { warn() {}, error() {}, info() {} } as never;
const today = () => localDate('Asia/Kolkata');

function makeGstin(state: string, pan: string) {
  for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (isValidGstin(`${state}${pan}1Z${c}`)) return `${state}${pan}1Z${c}`;
  throw new Error('no check digit');
}
const SHOP_GSTIN = makeGstin('09', 'ABCDE1234F');

/** Design shop registered for GST, with rates/HSN on most items. */
async function gstShop(phone = '9876543450', scheme: 'regular' | 'composition' = 'regular') {
  const shop = await t.shop(phone);
  const r = await t.inject('PUT', '/api/v1/store/tax', shop.token, { gstin: SHOP_GSTIN, gstScheme: scheme, legalName: 'Rajesh Sharma' });
  expect(r.statusCode).toBe(200);
  await t.inject('PATCH', '/api/v1/store', shop.token, { address: 'Station Road' });
  const set = (name: string, gstRate: number, hsnCode: string) =>
    t.inject('PATCH', `/api/v1/items/${shop.item(name).id}`, shop.token, { gstRate, hsnCode });
  await set('Atta 5 kg', 5, '1101');
  await set('Chawal 1 kg', 0, '1006');
  await set('Sarson tel 1 L', 5, '1514');
  await set('Cheeni 1 kg', 5, '1701');
  return shop;
}

const confirmBill = async (token: string, body: Record<string, unknown>) => {
  const r = await t.inject('POST', '/api/v1/bills', token, { ...body, confirm: true });
  if (r.statusCode !== 201) throw new Error(`bill failed: ${r.body}`);
  return r.json();
};

describe('GST: tax invoices', () => {
  it('splits MRP into taxable value + CGST/SGST and numbers invoices by financial year', async () => {
    const { token, item } = await gstShop();
    const res = await confirmBill(token, {
      paymentMode: 'cash',
      lines: [
        { itemId: item('Atta 5 kg').id, quantity: 1 },
        { itemId: item('Chawal 1 kg').id, quantity: 2 },
      ],
    });
    const bill = res.bill;
    expect(bill).toMatchObject({
      documentType: 'tax_invoice',
      invoiceNumber: `${financialYear(today())}/0001`,
      placeOfSupply: 'Uttar Pradesh',
      total: 36500,
      taxableTotal: 35333,
      cgstTotal: 584,
      sgstTotal: 583,
      igstTotal: 0,
      paidCash: 36500,
    });
    expect(bill.items.map((l: { name: string; gstRate: number; hsnCode: string; taxableValue: number }) => [l.name, l.gstRate, l.hsnCode, l.taxableValue])).toEqual([
      ['Atta', 5, '1101', 23333],
      ['Chawal', 0, '1006', 12000],
    ]);

    const token_ = bill.receiptLink.split('/r/')[1];
    const view = (await t.inject('GET', `/api/v1/public/receipts/${token_}`)).json();
    expect(view.store).toMatchObject({ gstin: SHOP_GSTIN, legalName: 'Rajesh Sharma', address: 'Station Road' });
    expect(view.taxSummary).toEqual([
      { rate: 0, taxableValue: 12000, cgst: 0, sgst: 0, igst: 0 },
      { rate: 5, taxableValue: 23333, cgst: 584, sgst: 583, igst: 0 },
    ]);
    const page = (await t.inject('GET', `/r/${token_}`)).body;
    expect(page).toContain('Tax Invoice');
    expect(page).toContain(`GSTIN ${SHOP_GSTIN}`);
    expect(page).toContain('HSN 1101');
    expect(page).toContain('CGST ₹5.84');
  });

  it('uses IGST for a business customer in another state', async () => {
    const { token, item } = await gstShop();
    const buyer = await t.customer(token, 'Patil Traders', undefined, { gstin: makeGstin('27', 'PQRST6789K') });
    const { bill } = await confirmBill(token, {
      customerId: buyer.id,
      paymentMode: 'upi',
      lines: [{ itemId: item('Sarson tel 1 L').id, quantity: 2 }],
    });
    expect(bill).toMatchObject({ total: 34000, taxableTotal: 32381, cgstTotal: 0, sgstTotal: 0, igstTotal: 1619, paidUpi: 34000 });
  });

  it('adds tax on top when prices exclude GST', async () => {
    const { token, item } = await gstShop();
    await t.inject('PUT', '/api/v1/store/tax', token, { pricesIncludeTax: false });
    const { bill } = await confirmBill(token, { paymentMode: 'cash', lines: [{ itemId: item('Cheeni 1 kg').id, quantity: 2 }] });
    expect(bill).toMatchObject({ taxableTotal: 9000, cgstTotal: 225, sgstTotal: 225, total: 9450 });
  });

  it('refuses to issue a tax invoice for items without a GST rate', async () => {
    const { token, item } = await gstShop();
    const r = await t.inject('POST', '/api/v1/bills', token, {
      paymentMode: 'cash',
      lines: [{ itemId: item('Maida 1 kg').id, quantity: 1 }],
      confirm: true,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'GST_RATE_MISSING', details: { items: ['Maida'] } });
  });

  it('composition shops issue a bill of supply without tax', async () => {
    const { token, item } = await gstShop('9876543450', 'composition');
    const { bill } = await confirmBill(token, { paymentMode: 'cash', lines: [{ itemId: item('Atta 5 kg').id, quantity: 1 }] });
    expect(bill).toMatchObject({ documentType: 'bill_of_supply', total: 24500, cgstTotal: 0, sgstTotal: 0 });
    const page = (await t.inject('GET', `/r/${bill.receiptLink.split('/r/')[1]}`)).body;
    expect(page).toContain('Bill of Supply');
    expect(page).toContain('Composition taxable person, not eligible to collect tax on supplies');
  });

  it('unregistered shops issue plain bills and print no GSTIN', async () => {
    const { token, item } = await t.shop();
    const { bill } = await confirmBill(token, { paymentMode: 'cash', lines: [{ itemId: item('Atta 5 kg').id, quantity: 1 }] });
    expect(bill).toMatchObject({ documentType: 'bill', cgstTotal: 0 });
    const view = (await t.inject('GET', `/api/v1/public/receipts/${bill.receiptLink.split('/r/')[1]}`)).json();
    expect(view.store.gstin).toBeNull();
  });

  it('invoice numbers restart in a new financial year', async () => {
    const { token, item } = await t.shop();
    await t.db.execute(sql`update stores set bill_counter = 50, bill_counter_fy = '2000-01'`);
    const line = { paymentMode: 'cash', lines: [{ itemId: item('Namak').id, quantity: 1 }] };
    expect((await confirmBill(token, line)).bill.invoiceNumber).toBe(`${financialYear(today())}/0001`);
    expect((await confirmBill(token, line)).bill.invoiceNumber).toBe(`${financialYear(today())}/0002`);
  });

  it('GST report: totals by rate and HSN, B2B invoices, documents issued and cancelled', async () => {
    const { token, item } = await gstShop();
    const buyer = await t.customer(token, 'Patil Traders', undefined, { gstin: makeGstin('27', 'PQRST6789K') });
    await confirmBill(token, {
      paymentMode: 'cash',
      lines: [
        { itemId: item('Atta 5 kg').id, quantity: 1 },
        { itemId: item('Chawal 1 kg').id, quantity: 2 },
      ],
    });
    await confirmBill(token, { customerId: buyer.id, paymentMode: 'upi', lines: [{ itemId: item('Sarson tel 1 L').id, quantity: 2 }] });
    const toCancel = await confirmBill(token, { paymentMode: 'cash', lines: [{ itemId: item('Cheeni 1 kg').id, quantity: 1 }] });
    await t.inject('POST', `/api/v1/bills/${toCancel.bill.id}/cancel`, token);

    const r = await t.inject('GET', `/api/v1/reports/gst?from=${today()}&to=${today()}`, token);
    expect(r.statusCode).toBe(200);
    const rep = r.json();
    expect(rep.byRate).toEqual([
      { rate: 0, invoices: 1, taxableValue: 12000, cgst: 0, sgst: 0, igst: 0, total: 12000 },
      { rate: 5, invoices: 2, taxableValue: 55714, cgst: 584, sgst: 583, igst: 1619, total: 58500 },
    ]);
    expect(rep.totals).toEqual({ taxableValue: 67714, cgst: 584, sgst: 583, igst: 1619, total: 70500 });
    expect(rep.byHsn.map((h: { hsnCode: string; quantity: number }) => [h.hsnCode, h.quantity])).toEqual([
      ['1006', 2],
      ['1101', 1],
      ['1514', 2],
    ]);
    expect(rep.b2b).toHaveLength(1);
    expect(rep.b2b[0]).toMatchObject({ customerName: 'Patil Traders', igst: 1619 });
    expect(rep.documents).toEqual([
      expect.objectContaining({ documentType: 'tax_invoice', issued: 3, cancelled: 1, last: toCancel.bill.invoiceNumber }),
    ]);
    expect(rep.cancelled.map((c: { invoiceNumber: string }) => c.invoiceNumber)).toEqual([toCancel.bill.invoiceNumber]);

    expect((await t.inject('GET', `/api/v1/reports/gst?from=${today()}&to=2000-01-01`, token)).statusCode).toBe(400);
  });
});

describe('part payment on udhaar ("200 abhi diye, baaki udhaar")', () => {
  it('records the cash part, puts only the rest in the khata, and the receipt shows both', async () => {
    const { token, item } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav', '9812345321');
    const res = await t.say(token, 'Ramesh ko paanch kilo atta, ek kilo toor dal, 200 abhi diye baaki udhaar mein likh do');
    expect(res.bill).toMatchObject({ paymentMode: 'udhaar', upfrontAmount: 20000, upfrontMethod: 'cash', total: 40500, canConfirm: true });

    const c = (await t.inject('POST', `/api/v1/bills/${res.bill.id}/confirm`, token)).json();
    expect(c.bill).toMatchObject({ paidCash: 20000, paidUpi: 0, creditAmount: 20500 });
    expect(c.effects.khata).toEqual({ before: 0, after: 20500 });
    const cust = (await t.inject('GET', `/api/v1/customers/${ramesh.id}`, token)).json().customer;
    // Kul kharid − Jama = Baaki, as on the customer's profile screen
    expect(cust).toMatchObject({ totalPurchases: 40500, totalPaid: 20000, balance: 20500 });

    await deliverPendingMessages(t.db, t.sender, silentLog);
    const receipt = t.sender.sent.find((m) => m.kind === 'receipt')!;
    expect(receipt.body).toContain('Abhi diye: ₹200');
    expect(receipt.body).toContain('Udhaar mein likha: ₹205');

    const s = (await t.inject('GET', '/api/v1/summary/daily', token)).json().summary;
    expect(s.sales).toMatchObject({ total: 40500, cash: 20000, cashAndUpi: 20000, udhaarGiven: 20500 });

    // Cancelling undoes exactly what was recorded
    await t.inject('POST', `/api/v1/bills/${res.bill.id}/cancel`, token);
    const after = (await t.inject('GET', `/api/v1/customers/${ramesh.id}`, token)).json().customer;
    expect(after).toMatchObject({ totalPurchases: 0, totalPaid: 0, balance: 0 });
    expect((await t.inject('GET', `/api/v1/items/${item('Atta 5 kg').id}`, token)).json().item.stock).toBe(24);
  });

  it('a part payment covering the whole bill is refused', async () => {
    const { token, item } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav');
    const r = await t.inject('POST', '/api/v1/bills', token, {
      customerId: c.id,
      paymentMode: 'udhaar',
      upfront: { amount: 245, method: 'upi' },
      lines: [{ itemId: item('Atta 5 kg').id, quantity: 1 }],
      confirm: true,
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('WhatsApp receipts: udhaar only, and only with consent', () => {
  it('cash and UPI bills never send a receipt', async () => {
    const { token, item } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321');
    const { effects, reply } = await confirmBill(token, { customerId: c.id, paymentMode: 'cash', lines: [{ itemId: item('Namak').id, quantity: 1 }] });
    expect(effects.receiptQueued).toBe(false);
    expect(reply.lines).not.toContain('Receipt Ramesh ko bhej di');
  });

  it('udhaar bills need recorded consent; the customer can give it from their link', async () => {
    const { token, item } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321', { consent: false });
    const udhaar = { customerId: c.id, paymentMode: 'udhaar', lines: [{ itemId: item('Namak').id, quantity: 1 }] };
    expect((await confirmBill(token, udhaar)).effects.receiptQueued).toBe(false);

    const reminder = await t.inject('POST', `/api/v1/customers/${c.id}/reminders`, token);
    expect(reminder.json().error.code).toBe('NO_CONSENT');

    const link = (await t.inject('GET', `/api/v1/customers/${c.id}`, token)).json().shareLink as string;
    await t.inject('POST', `/api/v1/public/customers/${link.split('/c/')[1]}/opt-in`);
    const after = (await t.inject('GET', `/api/v1/customers/${c.id}`, token)).json().customer;
    expect(after).toMatchObject({ messagingConsent: true, canMessage: true });
    expect((await confirmBill(token, udhaar)).effects.receiptQueued).toBe(true);
  });

  it('the shopkeeper can record or withdraw consent', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321', { consent: false });
    const on = await t.inject('PATCH', `/api/v1/customers/${c.id}`, token, { messagingConsent: true });
    expect(on.json().customer.canMessage).toBe(true);
    const off = await t.inject('PATCH', `/api/v1/customers/${c.id}`, token, { messagingConsent: false });
    expect(off.json().customer.canMessage).toBe(false);
  });
});

describe('correcting a wrong payment', () => {
  it('reverses a payment once, keeping both entries in the history', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321');
    await confirmBill(token, { customerId: c.id, paymentMode: 'udhaar', lines: [{ name: 'Purana baaki', quantity: 1, unitPrice: 1000 }] });
    const pay = (await t.inject('POST', `/api/v1/customers/${c.id}/payments`, token, { amount: 500 })).json();

    const rev = await t.inject('POST', `/api/v1/customers/${c.id}/ledger/${pay.entry.id}/reverse`, token, { note: 'Galti se likha' });
    expect(rev.statusCode).toBe(201);
    expect(rev.json().entry).toMatchObject({ type: 'payment_reversed', amount: 50000, balanceAfter: 100000, reversesEntryId: pay.entry.id });
    expect(rev.json().customer).toMatchObject({ balance: 100000, totalPaid: 0 });

    const again = await t.inject('POST', `/api/v1/customers/${c.id}/ledger/${pay.entry.id}/reverse`, token);
    expect(again.json().error.code).toBe('ALREADY_REVERSED');

    const ledger = (await t.inject('GET', `/api/v1/customers/${c.id}/ledger`, token)).json().data;
    expect(ledger.map((e: { type: string }) => e.type)).toEqual(['payment_reversed', 'payment', 'bill']);
    const billEntry = ledger[2];
    expect((await t.inject('POST', `/api/v1/customers/${c.id}/ledger/${billEntry.id}/reverse`, token)).statusCode).toBe(400);

    const s = (await t.inject('GET', '/api/v1/summary/daily', token)).json().summary;
    expect(s.udhaarRecovered).toBe(0);

    const link = (await t.inject('GET', `/api/v1/customers/${c.id}`, token)).json().shareLink as string;
    expect((await t.inject('GET', `/c/${link.split('/c/')[1]}`)).body).toContain('Galat entry hataayi');
  });

  it('cannot reverse another shop’s entry', async () => {
    const a = await t.shop('9876543450');
    const b = await t.shop('9876543451');
    const c = await t.customer(a.token, 'Ramesh Yadav');
    const pay = (await t.inject('POST', `/api/v1/customers/${c.id}/payments`, a.token, { amount: 10 })).json();
    expect((await t.inject('POST', `/api/v1/customers/${c.id}/ledger/${pay.entry.id}/reverse`, b.token)).statusCode).toBe(404);
  });
});
