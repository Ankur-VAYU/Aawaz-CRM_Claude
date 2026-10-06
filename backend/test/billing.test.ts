import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliverPendingMessages, queueDailySummaries } from '../src/messaging/workers.js';
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

/** Gives a customer an existing udhaar balance (rupees) via a confirmed bill. */
async function openingBalance(token: string, customerId: string, rupees: number) {
  const r = await t.inject('POST', '/api/v1/bills', token, {
    customerId,
    paymentMode: 'udhaar',
    lines: [{ name: 'Purana baaki', quantity: 1, unitPrice: rupees }],
    confirm: true,
  });
  expect(r.statusCode).toBe(201);
}

describe('screen 1 · voice billing', () => {
  it('draft → choose size → confirm updates stock, khata and sends the receipt', async () => {
    const { token, item } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav', '9812345321');
    await t.customer(token, 'Sunita Devi');
    await openingBalance(token, ramesh.id, 1240);

    const res = await t.say(token, 'Ramesh ko paanch kilo atta, ek kilo toor dal, do sarson tel… udhaar mein likh do');
    expect(res.intent).toBe('create_bill');
    expect(res.reply).toEqual({ text: 'Ek cheez saaf nahi hui. Ek tap mein chuniye.', speak: true });
    const draft = res.bill;
    expect(draft).toMatchObject({ status: 'draft', paymentMode: 'udhaar', billNumber: null, canConfirm: false, total: 40500 });
    expect(draft.customer).toMatchObject({ id: ramesh.id, name: 'Ramesh Yadav' });
    expect(draft.items.map((l: { name: string; quantity: number; amount: number }) => [l.name, l.quantity, l.amount])).toEqual([
      ['Atta', 1, 24500],
      ['Toor dal', 1, 16000],
    ]);
    expect(draft.issues).toHaveLength(1);
    const issue = draft.issues[0];
    expect(issue).toMatchObject({ kind: 'choose_variant', name: 'Sarson tel', quantity: 2 });
    expect(issue.options.map((o: { label: string; amount: number }) => [o.label, o.amount])).toEqual([
      ['Sarson tel 1 L', 34000],
      ['Sarson tel 500 ml', 18000],
    ]);

    const early = await t.inject('POST', `/api/v1/bills/${draft.id}/confirm`, token);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('BILL_HAS_ISSUES');

    const resolved = await t.inject('POST', `/api/v1/bills/${draft.id}/resolve`, token, {
      issueId: issue.id,
      itemId: item('Sarson tel 1 L').id,
    });
    expect(resolved.json().bill).toMatchObject({ total: 74500, canConfirm: true, issues: [] });

    const confirmed = await t.inject('POST', `/api/v1/bills/${draft.id}/confirm`, token);
    expect(confirmed.statusCode).toBe(200);
    const c = confirmed.json();
    expect(c.bill).toMatchObject({ status: 'confirmed', billNumber: 2, total: 74500 });
    expect(c.effects).toMatchObject({ stockReduced: 3, khata: { before: 124000, after: 198500 }, receiptQueued: true });
    expect(c.reply).toEqual({
      title: 'Ho gaya, sab likh diya',
      lines: ['Stock se 3 item kam kiye', 'Ramesh ka khata: ₹1,240 → ₹1,985', 'Receipt Ramesh ko bhej di'],
    });

    const items = (await t.inject('GET', '/api/v1/items', token)).json().data;
    const stock = (n: string) => items.find((i: { displayName: string }) => i.displayName === n).stock;
    expect([stock('Atta 5 kg'), stock('Toor dal 1 kg'), stock('Sarson tel 1 L'), stock('Sarson tel 500 ml')]).toEqual([23, 11, 8, 10]);

    // Confirming twice is refused
    expect((await t.inject('POST', `/api/v1/bills/${draft.id}/confirm`, token)).statusCode).toBe(409);

    // Screen 6 · the receipt reaches Ramesh on WhatsApp, with a working link
    await deliverPendingMessages(t.db, t.sender, silentLog);
    const receipts = t.sender.sent.filter((m) => m.kind === 'receipt');
    expect(receipts).toHaveLength(2); // opening balance + this bill
    const msg = receipts[1];
    expect(msg.to).toBe('+919812345321');
    expect(msg.body).toContain('Namaste Ramesh Yadav ji');
    expect(c.bill.invoiceNumber).toMatch(/^\d{4}-\d{2}\/0002$/);
    expect(msg.body).toContain(`Bill ${c.bill.invoiceNumber}`);
    expect(msg.body).toContain('Total: ₹745');
    expect(msg.body).toContain('Aapka kul baaki: ₹1,985');
    const token_ = c.bill.receiptLink.split('/r/')[1];
    expect(msg.body).toContain(`https://aawaz.test/r/${token_}`);

    const receipt = await t.inject('GET', `/api/v1/public/receipts/${token_}`);
    expect(receipt.json()).toMatchObject({ billNumber: 2, total: 74500, balance: 198500, customer: { name: 'Ramesh Yadav' } });
    const page = await t.inject('GET', `/r/${token_}`);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Namaste Ramesh Yadav ji');
    expect(page.body).toContain('₹1,985');
  });

  it('shows a clean draft reply when everything is understood', async () => {
    const { token } = await t.shop();
    const res = await t.say(token, '2 kilo cheeni aur ek namak');
    expect(res.bill).toMatchObject({ paymentMode: 'cash', customer: null, total: 11500, canConfirm: true });
    expect(res.reply.text).toBe('Bill · 2 item · ₹115. Check karke pakka karein.');
  });

  it('replies in Hindi and text-only when the shop chose that', async () => {
    const { token } = await t.shop();
    await t.inject('PUT', '/api/v1/store/preferences', token, { language: 'hi', replyStyle: 'text' });
    const res = await t.say(token, 'do kilo cheeni');
    expect(res.reply).toEqual({ text: 'बिल · 1 आइटम · ₹90। जाँच कर पक्का करें।', speak: false });
  });
});

describe('screen 5 · unclear speech and weak network', () => {
  it('offers likely items for the part that was not heard', async () => {
    const { token, item } = await t.shop();
    const res = await t.say(token, 'Paanch kilo chawal, ek namak, aur do kilo m…l?');
    const bill = res.bill;
    expect(bill.items.map((l: { name: string; quantity: number }) => [l.name, l.quantity])).toEqual([
      ['Chawal', 5],
      ['Namak', 1],
    ]);
    expect(bill.issues).toHaveLength(1);
    expect(bill.issues[0].kind).toBe('unclear');
    const labels = bill.issues[0].options.map((o: { label: string; amount: number }) => [o.label, o.amount]);
    expect(labels).toEqual(expect.arrayContaining([['Moong dal 1 kg', 26000], ['Maida 1 kg', 9000]]));

    const r = await t.inject('POST', `/api/v1/bills/${bill.id}/resolve`, token, {
      issueId: bill.issues[0].id,
      itemId: item('Moong dal 1 kg').id,
    });
    expect(r.json().bill).toMatchObject({ total: 30000 + 2500 + 26000, canConfirm: true });
  });

  it('bills saved offline are created once, however often the phone retries', async () => {
    const { token, item } = await t.shop();
    const body = {
      clientId: 'phone-1-bill-0001',
      paymentMode: 'cash',
      lines: [{ itemId: item('Chawal 1 kg').id, quantity: 5 }],
      confirm: true,
    };
    const first = await t.inject('POST', '/api/v1/bills', token, body);
    expect(first.statusCode).toBe(201);
    const [second, third] = await Promise.all([
      t.inject('POST', '/api/v1/bills', token, body),
      t.inject('POST', '/api/v1/bills', token, body),
    ]);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(second.json().bill.id).toBe(first.json().bill.id);
    const chawal = (await t.inject('GET', `/api/v1/items/${item('Chawal 1 kg').id}`, token)).json().item;
    expect(chawal.stock).toBe(45);
  });
});

describe('drafts: customers, prices and edits', () => {
  it('asks who an unknown customer is and can create them', async () => {
    const { token } = await t.shop();
    const res = await t.say(token, 'Pappu ko do kilo cheeni udhaar mein likh do');
    const issue = res.bill.issues[0];
    expect(issue).toMatchObject({ kind: 'customer_unknown', name: 'Pappu' });
    const r = await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, {
      issueId: issue.id,
      newCustomer: { name: 'Pappu Singh', phone: '9800000001' },
    });
    expect(r.json().bill).toMatchObject({ canConfirm: true, customer: { name: 'Pappu Singh' } });
  });

  it('asks which customer when several match', async () => {
    const { token } = await t.shop();
    await t.customer(token, 'Ramesh Yadav');
    const other = await t.customer(token, 'Ramesh Gupta');
    const res = await t.say(token, 'Ramesh ko ek namak udhaar');
    const issue = res.bill.issues[0];
    expect(issue.kind).toBe('customer_ambiguous');
    expect(issue.options).toHaveLength(2);
    const r = await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, { issueId: issue.id, customerId: other.id });
    expect(r.json().bill.customer.name).toBe('Ramesh Gupta');
  });

  it('udhaar needs a customer', async () => {
    const { token } = await t.shop();
    const res = await t.say(token, 'do kilo cheeni udhaar mein likh do');
    expect(res.bill.issues.map((i: { kind: string }) => i.kind)).toEqual(['customer_required']);
    // Switching to cash clears it
    const r = await t.inject('PATCH', `/api/v1/bills/${res.bill.id}`, token, { paymentMode: 'cash' });
    expect(r.json().bill).toMatchObject({ issues: [], canConfirm: true });
  });

  it('asks for a missing price and can save it to the item', async () => {
    const { token, item } = await t.shop();
    await t.inject('PATCH', `/api/v1/items/${item('Maida 1 kg').id}`, token, { price: null });
    const res = await t.say(token, 'teen kilo maida');
    const issue = res.bill.issues[0];
    expect(issue).toMatchObject({ kind: 'price_missing', quantity: 3, itemId: item('Maida 1 kg').id });
    const r = await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, { issueId: issue.id, unitPrice: 48, savePrice: true });
    expect(r.json().bill.total).toBe(14400);
    expect((await t.inject('GET', `/api/v1/items/${item('Maida 1 kg').id}`, token)).json().item.price).toBe(4800);
  });

  it('adds items that are not in the inventory, asking only for the price', async () => {
    const { token } = await t.shop();
    const res = await t.say(token, 'ek kilo cheeni, do sabun aur teen kilo pyaaz');
    const [sabun, pyaaz] = res.bill.issues;
    expect(sabun).toMatchObject({ kind: 'price_missing', name: 'Sabun', quantity: 2, autoAdded: true });
    expect(pyaaz).toMatchObject({ kind: 'price_missing', name: 'Pyaaz 1 kg', quantity: 3, autoAdded: true });
    const inventory = (await t.inject('GET', '/api/v1/items?search=pyaaz', token)).json().data;
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({ unit: 'kg', price: null, stock: 0 });

    // Price given once: on the bill and saved on the item
    const r = await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, { issueId: pyaaz.id, unitPrice: 40 });
    expect(r.json().bill.total).toBe(4500 + 12000);
    expect((await t.inject('GET', `/api/v1/items/${pyaaz.itemId}`, token)).json().item.price).toBe(4000);

    // Dropped from the bill: the automatic inventory entry goes away again
    await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, { issueId: sabun.id, remove: true });
    expect((await t.inject('GET', `/api/v1/items/${sabun.itemId}`, token)).statusCode).toBe(404);
    expect((await t.inject('POST', `/api/v1/bills/${res.bill.id}/confirm`, token)).statusCode).toBe(200);
  });

  it('a bill line that is not an item can still be added by hand', async () => {
    const { token } = await t.shop();
    const res = await t.say(token, 'ek kilo cheeni, do sabun');
    const issue = res.bill.issues[0];
    const r = await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, { issueId: issue.id, unitPrice: 30 });
    expect(r.json().bill).toMatchObject({ total: 4500 + 6000, canConfirm: true });
  });

  it('"Badlo": replaces lines on a draft', async () => {
    const { token, item } = await t.shop();
    const res = await t.say(token, 'do kilo cheeni');
    const r = await t.inject('PATCH', `/api/v1/bills/${res.bill.id}`, token, {
      lines: [{ itemId: item('Atta 5 kg').id, quantity: 2 }],
    });
    expect(r.json().bill).toMatchObject({ total: 49000, itemCount: 1 });
  });

  it('refuses udhaar when the shop does not give credit', async () => {
    const { token } = await t.shop('9876543450', { givesCredit: false });
    const c = await t.customer(token, 'Ramesh Yadav');
    const res = await t.say(token, 'Ramesh ko ek namak udhaar mein likh do');
    expect(res.bill.customer.id).toBe(c.id);
    const r = await t.inject('POST', `/api/v1/bills/${res.bill.id}/confirm`, token);
    expect(r.statusCode).toBe(400);
  });

  it('cancelling a confirmed bill restores stock and khata', async () => {
    const { token, item } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav');
    const res = await t.inject('POST', '/api/v1/bills', token, {
      customerId: c.id,
      paymentMode: 'udhaar',
      lines: [{ itemId: item('Atta 5 kg').id, quantity: 2 }],
      confirm: true,
    });
    const billId = res.json().bill.id;
    const cancelled = await t.inject('POST', `/api/v1/bills/${billId}/cancel`, token);
    expect(cancelled.json().bill.status).toBe('cancelled');
    expect((await t.inject('GET', `/api/v1/items/${item('Atta 5 kg').id}`, token)).json().item.stock).toBe(24);
    const cust = (await t.inject('GET', `/api/v1/customers/${c.id}`, token)).json().customer;
    expect(cust).toMatchObject({ balance: 0, totalPurchases: 0 });
    const ledger = (await t.inject('GET', `/api/v1/customers/${c.id}/ledger`, token)).json().data;
    expect(ledger.map((e: { type: string; amount: number }) => [e.type, e.amount])).toEqual([
      ['bill_cancelled', -49000],
      ['bill', 49000],
    ]);
  });

  it('other shops cannot touch a bill', async () => {
    const a = await t.shop('9876543450');
    const b = await t.shop('9876543451');
    const res = await t.say(a.token, 'do kilo cheeni');
    expect((await t.inject('GET', `/api/v1/bills/${res.bill.id}`, b.token)).statusCode).toBe(404);
    expect((await t.inject('POST', `/api/v1/bills/${res.bill.id}/confirm`, b.token)).statusCode).toBe(404);
  });
});

describe('screen 2 · khata', () => {
  it('"kitna baaki hai?", payments and history', async () => {
    const { token } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav', '9812345321');
    await openingBalance(token, ramesh.id, 1985);

    const q = await t.say(token, 'Ramesh ka kitna baaki hai?');
    expect(q).toMatchObject({ intent: 'query_balance', reply: { text: 'Ramesh Yadav ka kul baaki ₹1,985 hai' } });
    expect(q.customer.balance).toBe(198500);

    const paid = await t.say(token, 'Ramesh ne paanch sau rupaye diye UPI se');
    expect(paid.reply.text).toBe('Ramesh Yadav se ₹500 mile. Ab baaki ₹1,485.');
    expect(paid.entry).toMatchObject({ type: 'payment', amount: -50000, method: 'upi', balanceAfter: 148500 });

    // A retried voice message with the same clientId doesn't take the money off twice
    const retry1 = await t.say(token, 'Ramesh ne 100 diye', { clientId: 'msg-retry-0001' });
    const retry2 = await t.say(token, 'Ramesh ne 100 diye', { clientId: 'msg-retry-0001' });
    expect(retry2.entry.id).toBe(retry1.entry.id);
    expect(retry2.customer.balance).toBe(138500);

    // "Paisa mila" button, sent twice from a phone on a weak network
    const pay = { amount: 85, method: 'cash', clientId: 'phone-1-pay-0001' };
    const btn = await t.inject('POST', `/api/v1/customers/${ramesh.id}/payments`, token, pay);
    expect(btn.statusCode).toBe(201);
    expect(btn.json().customer).toMatchObject({ balance: 130000, totalPaid: 68500 });
    const dup = await t.inject('POST', `/api/v1/customers/${ramesh.id}/payments`, token, pay);
    expect(dup.statusCode).toBe(200);
    expect(dup.json()).toMatchObject({ duplicate: true, customer: { balance: 130000 } });

    const ledger = (await t.inject('GET', `/api/v1/customers/${ramesh.id}/ledger`, token)).json();
    expect(ledger.data.map((e: { type: string; balanceAfter: number }) => [e.type, e.balanceAfter])).toEqual([
      ['payment', 130000],
      ['payment', 138500],
      ['payment', 148500],
      ['bill', 198500],
    ]);
    expect(ledger.data[3]).toMatchObject({ billNumber: 1, itemCount: 1, invoiceNumber: expect.stringMatching(/\/0001$/) });

    const unknown = await t.say(token, 'Kishore ka kitna baaki hai');
    expect(unknown).toMatchObject({ reply: { text: '"Kishore" naam ka grahak nahi mila' }, needsInput: { kind: 'customer_unknown' } });
  });

  it('"Yaad dilao": reminder once a day, respecting opt-out', async () => {
    const { token } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav', '9812345321');
    const noPhone = await t.customer(token, 'Sunita Devi');
    await openingBalance(token, ramesh.id, 500);
    await openingBalance(token, noPhone.id, 500);

    expect((await t.inject('POST', `/api/v1/customers/${ramesh.id}/reminders`, token)).statusCode).toBe(202);
    const again = await t.inject('POST', `/api/v1/customers/${ramesh.id}/reminders`, token);
    expect(again.json().error.code).toBe('REMINDER_TOO_SOON');
    expect((await t.inject('POST', `/api/v1/customers/${noPhone.id}/reminders`, token)).statusCode).toBe(400);

    await deliverPendingMessages(t.db, t.sender, silentLog);
    const reminder = t.sender.sent.find((m) => m.kind === 'reminder')!;
    expect(reminder.body).toContain('aapka baaki ₹500');

    // Customer turns messages off from their link
    const link = (await t.inject('GET', `/api/v1/customers/${ramesh.id}`, token)).json().shareLink as string;
    const shareToken = link.split('/c/')[1];
    await t.db.execute(sql`delete from outbound_messages`);
    await t.inject('POST', `/api/v1/public/customers/${shareToken}/opt-out`);
    const blocked = await t.inject('POST', `/api/v1/customers/${ramesh.id}/reminders`, token);
    expect(blocked.json().error.code).toBe('OPTED_OUT');
  });
});

describe('screen 7 · customer list', () => {
  it('filters, counts and total dues', async () => {
    const { token } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav');
    const sunita = await t.customer(token, 'Sunita Devi');
    const pappu = await t.customer(token, 'Pappu Singh');
    await t.customer(token, 'Kavita Sharma');
    await openingBalance(token, ramesh.id, 1985);
    await openingBalance(token, sunita.id, 1450);
    await t.db.execute(sql`update customers set created_at = now() - interval '30 days', last_purchase_at = now() - interval '21 days' where id = ${pappu.id}`);

    const all = (await t.inject('GET', '/api/v1/customers', token)).json();
    expect(all.counts).toEqual({ all: 4, dues: 2, inactive: 1 });
    expect(all.totalDues).toBe(343500);
    expect(all.data.map((c: { name: string }) => c.name).slice(0, 2)).toEqual(['Ramesh Yadav', 'Sunita Devi']);
    expect(all.data[0].initials).toBe('RY');

    const dues = (await t.inject('GET', '/api/v1/customers?filter=dues', token)).json();
    expect(dues.data).toHaveLength(2);
    const inactive = (await t.inject('GET', '/api/v1/customers?filter=inactive', token)).json();
    expect(inactive.data.map((c: { name: string; inactive: boolean }) => [c.name, c.inactive])).toEqual([['Pappu Singh', true]]);

    const voice = await t.say(token, 'Grahak list dikhao');
    expect(voice.reply.text).toBe('Aapke grahak · 4. Kul udhaar baaki ₹3,435');
  });

  it('duplicate phone numbers are refused', async () => {
    const { token } = await t.shop();
    await t.customer(token, 'A', '9800000001');
    const r = await t.inject('POST', '/api/v1/customers', token, { name: 'B', phone: '+91 98000 00001' });
    expect(r.statusCode).toBe(409);
  });
});

describe('screen 8 · customer’s own view', () => {
  it('shows the khata through the private link and handles deletion requests', async () => {
    const { token } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav', '9812345321');
    await openingBalance(token, ramesh.id, 620);
    const shareToken = ((await t.inject('GET', `/api/v1/customers/${ramesh.id}`, token)).json().shareLink as string).split('/c/')[1];

    const view = (await t.inject('GET', `/api/v1/public/customers/${shareToken}`)).json();
    expect(view).toMatchObject({
      store: { name: 'Sharma Kirana Store' },
      customer: { name: 'Ramesh Yadav', phone: '98••• ••321' },
      balance: 62000,
      totalPurchases: 62000,
      totalPaid: 0,
    });
    expect(view.entries).toHaveLength(1);
    const html = await t.inject('GET', `/c/${shareToken}`);
    expect(html.body).toContain('AAPKA BAAKI');
    expect(html.body).toContain('₹620');
    expect((await t.inject('GET', '/c/not-a-real-token-xxxxxxxxxxxx')).statusCode).toBe(404);

    // With money due, the request is recorded for the shopkeeper instead of deleting
    const pending = (await t.inject('POST', `/api/v1/public/customers/${shareToken}/delete-request`)).json();
    expect(pending).toMatchObject({ deleted: false, reason: 'BALANCE_DUE' });
    expect((await t.inject('GET', `/api/v1/customers/${ramesh.id}`, token)).json().customer.deletionRequestedAt).not.toBeNull();

    await t.inject('POST', `/api/v1/customers/${ramesh.id}/payments`, token, { amount: 620 });
    const done = (await t.inject('POST', `/api/v1/public/customers/${shareToken}/delete-request`)).json();
    expect(done).toEqual({ deleted: true });
    expect((await t.inject('GET', `/api/v1/public/customers/${shareToken}`)).statusCode).toBe(404);
    expect((await t.inject('GET', `/api/v1/customers/${ramesh.id}`, token)).statusCode).toBe(404);
  });

  it('escapes customer data in HTML pages', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, '<script>alert(1)</script>');
    const shareToken = ((await t.inject('GET', `/api/v1/customers/${c.id}`, token)).json().shareLink as string).split('/c/')[1];
    const html = await t.inject('GET', `/c/${shareToken}`);
    expect(html.body).not.toContain('<script>alert(1)</script>');
    expect(html.body).toContain('&#60;script&#62;');
  });
});

describe('screen 3 · daily summary', () => {
  it('sums the day and is queued once per day at summary time', async () => {
    const { token, item } = await t.shop();
    const ramesh = await t.customer(token, 'Ramesh Yadav');
    await t.inject('POST', '/api/v1/bills', token, { paymentMode: 'cash', lines: [{ itemId: item('Atta 5 kg').id, quantity: 2 }], confirm: true });
    await t.inject('POST', '/api/v1/bills', token, { paymentMode: 'upi', lines: [{ itemId: item('Chawal 1 kg').id, quantity: 1 }], confirm: true });
    await t.inject('POST', '/api/v1/bills', token, {
      customerId: ramesh.id,
      paymentMode: 'udhaar',
      lines: [{ itemId: item('Toor dal 1 kg').id, quantity: 1 }],
      confirm: true,
    });
    await t.inject('POST', `/api/v1/customers/${ramesh.id}/payments`, token, { amount: 100 });
    await t.say(token, 'do kilo cheeni'); // draft only: not counted

    const s = (await t.inject('GET', '/api/v1/summary/daily', token)).json().summary;
    expect(s.sales).toEqual({ total: 71000, bills: 3, voiceBills: 0, cashAndUpi: 55000, cash: 49000, upi: 6000, udhaarGiven: 16000 });
    expect(s.udhaarRecovered).toBe(10000);
    expect(s.newCustomers).toBe(1);
    expect(s.lowStock.map((i: { name: string }) => i.name)).toEqual(['Cheeni 1 kg']);
    expect(s.topDues).toEqual([{ id: ramesh.id, name: 'Ramesh Yadav', balance: 6000 }]);

    const voice = await t.say(token, 'aaj ka hisaab');
    expect(voice.reply.text).toBe('Aaj ki bikri ₹710 · 3 bill');

    // Scheduler: before 21:00 IST nothing; after, exactly once.
    const today = s.date as string;
    const at = (hhmm: string) => new Date(`${today}T${hhmm}:00+05:30`);
    expect(await queueDailySummaries(t.db, at('20:59'))).toBe(0);
    expect(await queueDailySummaries(t.db, at('21:00'))).toBe(1);
    expect(await queueDailySummaries(t.db, at('21:05'))).toBe(0);
    await deliverPendingMessages(t.db, t.sender, silentLog);
    const msg = t.sender.sent.find((m) => m.kind === 'daily_summary')!;
    expect(msg.to).toBe('+919876543450');
    expect(msg.body).toContain('₹710 · 3 bill');
  });
});

describe('message delivery', () => {
  it('retries failures with backoff', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321');
    await openingBalance(token, c.id, 100);
    t.sender.failNext = 1;
    await deliverPendingMessages(t.db, t.sender, silentLog);
    const [row] = (await t.db.execute(sql`select status, attempts, send_after > now() as later from outbound_messages`)).rows;
    expect(row).toMatchObject({ status: 'pending', attempts: 1, later: true });
    await t.db.execute(sql`update outbound_messages set send_after = now()`);
    await deliverPendingMessages(t.db, t.sender, silentLog);
    expect(t.sender.sent.filter((m) => m.kind === 'receipt')).toHaveLength(1);
  });
});

describe('assistant', () => {
  it('low stock and not-understood replies', async () => {
    const { token } = await t.shop();
    const low = await t.say(token, 'kaunsa stock kam hai');
    expect(low.reply.text).toBe('1 item ka stock kam hai');
    const huh = await t.say(token, 'hmm');
    expect(huh).toMatchObject({ intent: 'unknown', reply: { text: expect.stringContaining('Samajh nahi aaya') } });
    expect((await t.inject('GET', '/api/v1/bills', token)).json().data).toHaveLength(0);
  });
});
