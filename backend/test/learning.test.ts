import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aliasFrom, purgeOldVoiceEvents } from '../src/modules/learning/learning.service.js';
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

describe('learning from corrections', () => {
  it('only learns real words', () => {
    expect(aliasFrom('Moongi')).toBe('moongi');
    expect(aliasFrom('m l')).toBeNull();
    expect(aliasFrom('2 kg')).toBeNull();
    expect(aliasFrom('ab')).toBeNull();
  });

  it('remembers what an item was called after the shopkeeper picks the right one', async () => {
    const { token, item } = await t.shop();
    const first = await t.say(token, 'teen kilo moongi');
    const issue = first.bill.issues[0];
    expect(issue).toMatchObject({ kind: 'price_missing', autoAdded: true, spoken: 'moongi' });

    // "No, I meant Moong dal": swap for the existing item
    const r = await t.inject('POST', `/api/v1/bills/${first.bill.id}/resolve`, token, { issueId: issue.id, itemId: item('Moong dal 1 kg').id });
    expect(r.json().learned).toEqual({ type: 'item', heard: 'moongi', name: 'Moong dal 1 kg' });
    expect(r.json().bill.items.map((l: { name: string; quantity: number }) => [l.name, l.quantity])).toEqual([['Moong dal', 3]]);
    // the automatically added "Moongi" is gone again
    expect((await t.inject('GET', `/api/v1/items/${issue.itemId}`, token)).statusCode).toBe(404);

    // Next time it's understood straight away
    const again = await t.say(token, 'do kilo moongi');
    expect(again.bill.issues).toEqual([]);
    expect(again.bill.items.map((l: { name: string }) => l.name)).toEqual(['Moong dal']);
  });

  it('remembers who a spoken customer name is, and can forget it', async () => {
    const { token } = await t.shop();
    const pradeep = await t.customer(token, 'Pradeep Kumar');
    const first = await t.say(token, 'Pintu ko ek namak udhaar mein likh do');
    const issue = first.bill.issues[0];
    expect(issue).toMatchObject({ kind: 'customer_unknown', name: 'Pintu' });
    const r = await t.inject('POST', `/api/v1/bills/${first.bill.id}/resolve`, token, { issueId: issue.id, customerId: pradeep.id });
    expect(r.json().learned).toEqual({ type: 'customer', heard: 'pintu', name: 'Pradeep Kumar' });

    const q = await t.say(token, 'Pintu ka kitna baaki hai');
    expect(q.intent).toBe('query_balance');
    expect(q.customer.id).toBe(pradeep.id);

    const learned = (await t.inject('GET', '/api/v1/assistant/learned', token)).json();
    expect(learned.customers).toEqual([{ id: pradeep.id, name: 'Pradeep Kumar', aliases: ['pintu'] }]);

    const del = await t.inject('DELETE', '/api/v1/assistant/learned', token, { kind: 'customer', id: pradeep.id, alias: 'Pintu' });
    expect(del.statusCode).toBe(204);
    expect((await t.say(token, 'Pintu ka kitna baaki hai')).needsInput).toMatchObject({ kind: 'customer_unknown' });
  });

  it('a name another shop learned does not leak', async () => {
    const a = await t.shop('9876543450');
    const b = await t.shop('9876543451');
    const first = await t.say(a.token, 'teen kilo moongi');
    await t.inject('POST', `/api/v1/bills/${first.bill.id}/resolve`, a.token, { issueId: first.bill.issues[0].id, itemId: a.item('Moong dal 1 kg').id });
    const other = await t.say(b.token, 'do kilo moongi');
    expect(other.bill.issues[0]).toMatchObject({ kind: 'price_missing', autoAdded: true });
  });
});

describe('voice log (only with permission)', () => {
  it('logs nothing until the shop opts in, then records misses and corrections', async () => {
    const { token, item } = await t.shop();
    await t.say(token, 'hmm kuch bhi');
    expect((await t.inject('GET', '/api/v1/assistant/voice-log', token)).json()).toMatchObject({ optedIn: false, data: [] });

    expect((await t.inject('PATCH', '/api/v1/store', token, { voiceLogOptIn: true })).json().store.voiceLogOptIn).toBe(true);
    await t.say(token, 'hmm kuch bhi', { source: 'voice' });
    const bill = await t.say(token, 'teen kilo moongi');
    await t.inject('POST', `/api/v1/bills/${bill.bill.id}/resolve`, token, { issueId: bill.bill.issues[0].id, itemId: item('Moong dal 1 kg').id });

    const log = (await t.inject('GET', '/api/v1/assistant/voice-log', token)).json();
    expect(log.retentionDays).toBe(90);
    expect(log.data.map((e: { outcome: string; text: string }) => [e.outcome, e.text])).toEqual([
      ['corrected', 'teen kilo moongi'],
      ['needs_input', 'teen kilo moongi'],
      ['not_understood', 'hmm kuch bhi'],
    ]);
    expect(log.data[0].details).toMatchObject({ heard: 'moongi', learned: { name: 'Moong dal 1 kg' } });
    expect(log.data[2]).toMatchObject({ source: 'voice', language: 'hinglish', intent: 'unknown' });

    expect((await t.inject('DELETE', '/api/v1/assistant/voice-log', token)).statusCode).toBe(204);
    expect((await t.inject('GET', '/api/v1/assistant/voice-log', token)).json().data).toEqual([]);
  });

  it('old events are purged', async () => {
    const { token } = await t.shop();
    await t.inject('PATCH', '/api/v1/store', token, { voiceLogOptIn: true });
    await t.say(token, 'hmm kuch bhi');
    await t.say(token, 'phir se kuch bhi');
    await t.db.execute(sql`update voice_events set created_at = now() - interval '91 days' where text = 'hmm kuch bhi'`);
    expect(await purgeOldVoiceEvents(t.db)).toBe(1);
    expect((await t.inject('GET', '/api/v1/assistant/voice-log', token)).json().data).toHaveLength(1);
  });
});
