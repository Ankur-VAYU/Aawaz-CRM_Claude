import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestCtx } from './helpers.js';

/*
 * Data-integrity checks under concurrency: many requests at the same moment must never lose an
 * update, double-count money or stock, deadlock, or leave the khata out of step with its totals.
 */

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

/** Every customer's balance equals the sum of their ledger, and purchases − paid = balance. */
async function checkKhataInvariants() {
  const bad = await t.db.execute(sql`
    select c.name, c.balance, c.total_purchases, c.total_paid, coalesce(sum(l.amount), 0) as ledger
    from customers c left join ledger_entries l on l.customer_id = c.id
    group by c.id
    having c.balance <> coalesce(sum(l.amount), 0) or c.total_purchases - c.total_paid <> c.balance`);
  expect(bad.rows).toEqual([]);
}

describe('concurrency and integrity', () => {
  it('confirming many bills at once: no deadlocks, exact stock, unique consecutive invoice numbers', async () => {
    const { token, item } = await t.shop();
    const atta = item('Atta 5 kg').id;
    const chawal = item('Chawal 1 kg').id;
    await t.inject('POST', `/api/v1/items/${atta}/stock`, token, { delta: 1000 });
    await t.inject('POST', `/api/v1/items/${chawal}/stock`, token, { delta: 1000 });
    const c = await t.customer(token, 'Ramesh Yadav');

    // Drafts touch the same items in opposite orders (classic deadlock pattern)
    const drafts = [];
    for (let k = 0; k < 24; k++) {
      const lines = k % 2 ? [{ itemId: atta, quantity: 1 }, { itemId: chawal, quantity: 2 }] : [{ itemId: chawal, quantity: 2 }, { itemId: atta, quantity: 1 }];
      const r = await t.inject('POST', '/api/v1/bills', token, { customerId: c.id, paymentMode: k % 3 ? 'udhaar' : 'cash', lines });
      drafts.push(r.json().bill);
    }
    // Some confirmed bills to cancel while others confirm, and stock arriving at the same time
    const toCancel = [];
    for (let k = 0; k < 6; k++) {
      const r = await t.inject('POST', '/api/v1/bills', token, {
        customerId: c.id, paymentMode: 'udhaar', confirm: true,
        lines: [{ itemId: chawal, quantity: 1 }, { itemId: atta, quantity: 1 }],
      });
      toCancel.push(r.json().bill.id);
    }

    const results = await Promise.all([
      ...drafts.map((d) => t.inject('POST', `/api/v1/bills/${d.id}/confirm`, token)),
      ...toCancel.map((id) => t.inject('POST', `/api/v1/bills/${id}/cancel`, token)),
      ...Array.from({ length: 6 }, () =>
        t.inject('POST', '/api/v1/items/receive', token, { lines: [{ itemId: chawal, quantity: 5 }, { itemId: atta, quantity: 5 }] }),
      ),
    ]);
    const failures = results.filter((r) => r.statusCode >= 300).map((r) => `${r.statusCode} ${r.body}`);
    expect(failures).toEqual([]);

    const stock = async (id: string) => (await t.inject('GET', `/api/v1/items/${id}`, token)).json().item.stock;
    // 24 confirmed + 6 confirmed-then-cancelled (net 0) + 6 deliveries of 5
    expect(await stock(atta)).toBe(24 + 1000 - 24 + 30);
    expect(await stock(chawal)).toBe(50 + 1000 - 48 + 30);

    const nums = (await t.db.execute(sql`select bill_number from bills where status <> 'draft' order by bill_number`)).rows.map((r) => Number(r.bill_number));
    expect(nums).toEqual(Array.from({ length: 30 }, (_, k) => k + 1));
    await checkKhataInvariants();
  });

  it('many payments to one customer at once: none lost, ledger chain consistent', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav');
    await t.inject('POST', '/api/v1/bills', token, {
      customerId: c.id, paymentMode: 'udhaar', confirm: true, lines: [{ name: 'Purana baaki', quantity: 1, unitPrice: 10000 }],
    });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, k) => t.inject('POST', `/api/v1/customers/${c.id}/payments`, token, { amount: 10 + k, method: 'cash' })),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const paid = Array.from({ length: 40 }, (_, k) => 10 + k).reduce((a, b) => a + b, 0);
    const cust = (await t.inject('GET', `/api/v1/customers/${c.id}`, token)).json().customer;
    expect(cust.balance).toBe((10000 - paid) * 100);
    // No two entries saw the same balance (no lost update), and the entries add up to the balance
    const entries = (await t.db.execute(sql`select amount, balance_after from ledger_entries where customer_id = ${c.id}`)).rows
      .map((r) => ({ amount: Number(r.amount), after: Number(r.balance_after) }));
    expect(new Set(entries.map((r) => r.after)).size).toBe(entries.length);
    expect(entries.reduce((s, r) => s + r.amount, 0)).toBe(cust.balance);
    await checkKhataInvariants();
  });

  it('the same bill confirmed twice at once is confirmed exactly once', async () => {
    const { token, item } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav');
    const d = (await t.inject('POST', '/api/v1/bills', token, { customerId: c.id, paymentMode: 'udhaar', lines: [{ itemId: item('Namak').id, quantity: 1 }] })).json().bill;
    const rs = await Promise.all([1, 2, 3].map(() => t.inject('POST', `/api/v1/bills/${d.id}/confirm`, token)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await t.inject('GET', `/api/v1/items/${item('Namak').id}`, token)).json().item.stock).toBe(29);
    await checkKhataInvariants();
  });

  it('a cancelled bill cannot be cancelled twice in parallel', async () => {
    const { token, item } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav');
    const b = (await t.inject('POST', '/api/v1/bills', token, { customerId: c.id, paymentMode: 'udhaar', confirm: true, lines: [{ itemId: item('Namak').id, quantity: 1 }] })).json().bill;
    const rs = await Promise.all([1, 2, 3].map(() => t.inject('POST', `/api/v1/bills/${b.id}/cancel`, token)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await t.inject('GET', `/api/v1/items/${item('Namak').id}`, token)).json().item.stock).toBe(30);
    await checkKhataInvariants();
  });
});

import { deliverPendingMessages } from '../src/messaging/workers.js';
import { MemorySender } from '../src/messaging/sender.js';

describe('message delivery under concurrency', () => {
  const silentLog = { warn() {}, error() {}, info() {} } as never;

  it('two senders running at once never send the same message twice', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321');
    for (let k = 0; k < 15; k++) {
      await t.inject('POST', '/api/v1/bills', token, {
        customerId: c.id, paymentMode: 'udhaar', confirm: true, lines: [{ name: `Item ${k}`, quantity: 1, unitPrice: 10 }],
      });
    }
    const a = new MemorySender();
    const b = new MemorySender();
    await Promise.all([deliverPendingMessages(t.db, a, silentLog, 50), deliverPendingMessages(t.db, b, silentLog, 50)]);
    expect(a.sent.length + b.sent.length).toBe(15);
    const bodies = [...a.sent, ...b.sent].map((m) => m.body);
    expect(new Set(bodies).size).toBe(15);
  });

  it('a message claimed by a sender that crashed is sent after the claim expires', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav', '9812345321');
    await t.inject('POST', '/api/v1/bills', token, {
      customerId: c.id, paymentMode: 'udhaar', confirm: true, lines: [{ name: 'Purana baaki', quantity: 1, unitPrice: 10 }],
    });
    // Simulate a crash right after claiming
    await t.db.execute(sql`update outbound_messages set locked_until = now() + interval '2 minutes'`);
    const s = new MemorySender();
    expect(await deliverPendingMessages(t.db, s, silentLog)).toBe(0);
    await t.db.execute(sql`update outbound_messages set locked_until = now() - interval '1 second'`);
    expect(await deliverPendingMessages(t.db, s, silentLog)).toBe(1);
    expect(s.sent).toHaveLength(1);
    const [row] = (await t.db.execute(sql`select status, locked_until from outbound_messages`)).rows;
    expect(row).toMatchObject({ status: 'sent', locked_until: null });
  });
});
