import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('Hindi, Hinglish and English', () => {
  it('an English-speaking shop bills in English, matching English item names', async () => {
    const { token, item } = await t.shop();
    expect((await t.inject('PUT', '/api/v1/store/preferences', token, { language: 'en', replyStyle: 'text' })).statusCode).toBe(200);
    const ramesh = await t.customer(token, 'Ramesh Yadav', '9812345321');

    const res = await t.say(token, '2 kg sugar and half kg salt for Ramesh on credit');
    expect(res.reply).toEqual({ text: 'One thing needs your answer. Pick with one tap.', speak: false });
    // "half kg salt" doesn't fit salt sold per piece, so it asks; sugar matched by its English alias
    expect(res.bill.items.map((l: { name: string; quantity: number }) => [l.name, l.quantity])).toEqual([['Cheeni', 2]]);
    const issue = res.bill.issues[0];
    await t.inject('POST', `/api/v1/bills/${res.bill.id}/resolve`, token, { issueId: issue.id, itemId: item('Namak').id, quantity: 1 });
    const c = (await t.inject('POST', `/api/v1/bills/${res.bill.id}/confirm`, token)).json();
    expect(c.reply.title).toBe('Done, all recorded');
    expect(c.reply.lines).toContain("Ramesh's balance: ₹0 → ₹115");

    await deliverPendingMessages(t.db, t.sender, silentLog);
    const receipt = t.sender.sent.find((m) => m.kind === 'receipt')!;
    expect(receipt.body).toContain('Hello Ramesh Yadav');
    expect(receipt.body).toContain('Your total due: ₹115');

    const q = await t.say(token, 'How much does Ramesh owe?');
    expect(q.reply.text).toBe('Ramesh Yadav owes ₹115 in total');
    expect(q.customer.id).toBe(ramesh.id);
  });

  it('the same question answers in each language', async () => {
    const { token } = await t.shop();
    const c = await t.customer(token, 'Ramesh Yadav');
    await t.inject('POST', '/api/v1/bills', token, {
      customerId: c.id,
      paymentMode: 'udhaar',
      lines: [{ name: 'Purana baaki', quantity: 1, unitPrice: 500 }],
      confirm: true,
    });
    const answers: Record<string, string> = {};
    for (const language of ['hi', 'hinglish', 'en']) {
      await t.inject('PUT', '/api/v1/store/preferences', token, { language, replyStyle: 'voice_text' });
      answers[language] = (await t.say(token, 'Ramesh ka kitna baaki hai?')).reply.text;
    }
    expect(answers).toEqual({
      hi: 'Ramesh Yadav का कुल बाकी ₹500 है',
      hinglish: 'Ramesh Yadav ka kul baaki ₹500 hai',
      en: 'Ramesh Yadav owes ₹500 in total',
    });
  });

  it('rejects unknown languages', async () => {
    const { token } = await t.shop();
    const r = await t.inject('PUT', '/api/v1/store/preferences', token, { language: 'fr', replyStyle: 'text' });
    expect(r.statusCode).toBe(400);
  });
});
