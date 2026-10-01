import { describe, expect, it } from 'vitest';
import { parseAmount, parseCommand, parseLine } from '../src/modules/assistant/parser.js';

describe('parseCommand: bills', () => {
  it('parses the main design example', () => {
    const intent = parseCommand('Ramesh ko paanch kilo atta, ek kilo toor dal, do sarson tel… udhaar mein likh do');
    expect(intent).toMatchObject({ type: 'create_bill', customerName: 'Ramesh', paymentMode: 'udhaar' });
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map(({ name, count, measure }) => ({ name, count, measure }))).toEqual([
      { name: 'atta', count: null, measure: { value: 5, unit: 'kg' } },
      { name: 'toor dal', count: null, measure: { value: 1, unit: 'kg' } },
      { name: 'sarson tel', count: 2, measure: null },
    ]);
    expect(intent.lines.every((l) => !l.unclear)).toBe(true);
  });

  it('parses a cash bill without a customer, digits and units glued to numbers', () => {
    const intent = parseCommand('2kg cheeni aur 500 gram jeera');
    expect(intent).toMatchObject({ type: 'create_bill', customerName: null, paymentMode: 'cash' });
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map((l) => [l.name, l.measure])).toEqual([
      ['cheeni', { value: 2, unit: 'kg' }],
      ['jeera', { value: 500, unit: 'g' }],
    ]);
  });

  it('detects UPI and fractional words', () => {
    const intent = parseCommand('dedh kilo chawal, aadha kilo cheeni UPI se');
    expect(intent).toMatchObject({ type: 'create_bill', paymentMode: 'upi' });
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map((l) => l.measure)).toEqual([
      { value: 1.5, unit: 'kg' },
      { value: 0.5, unit: 'kg' },
    ]);
  });

  it('marks unclear segments from the speech recogniser', () => {
    const intent = parseCommand('Paanch kilo chawal, ek namak, aur do kilo m…l?');
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines).toHaveLength(3);
    expect(intent.lines[2]).toMatchObject({ unclear: true, measure: { value: 2, unit: 'kg' } });
    expect(intent.lines[1]).toMatchObject({ name: 'namak', count: 1, unclear: false });
  });

  it('reads count and size together', () => {
    expect(parseLine('2 x sarson tel 1 litre')).toMatchObject({
      name: 'sarson tel',
      count: 2,
      measure: { value: 1, unit: 'l' },
    });
    expect(parseLine('ek packet maggi')).toMatchObject({ name: 'maggi', count: 1, measure: null });
  });

  it('handles Devanagari digits', () => {
    expect(parseLine('५ kg atta')).toMatchObject({ name: 'atta', measure: { value: 5, unit: 'kg' } });
  });
});

describe('parseCommand: other intents', () => {
  it('balance queries', () => {
    expect(parseCommand('Ramesh ka kitna baaki hai?')).toEqual({ type: 'query_balance', customerName: 'Ramesh' });
    expect(parseCommand('Sunita ka khata')).toEqual({ type: 'query_balance', customerName: 'Sunita' });
  });

  it('payments with spoken amounts', () => {
    expect(parseCommand('Ramesh ne paanch sau rupaye diye UPI se')).toEqual({
      type: 'record_payment',
      customerName: 'Ramesh',
      amount: 50000,
      method: 'upi',
    });
    expect(parseCommand('Sunita Devi ne 1,200 jama kiye')).toMatchObject({ customerName: 'Sunita Devi', amount: 120000, method: 'cash' });
  });

  it('lists, summary, stock and reminders', () => {
    expect(parseCommand('Grahak list dikhao')).toEqual({ type: 'list_customers' });
    expect(parseCommand('aaj ka hisaab batao')).toEqual({ type: 'daily_summary' });
    expect(parseCommand('kaunsa stock kam hai')).toEqual({ type: 'low_stock' });
    expect(parseCommand('Ramesh ko yaad dilao')).toEqual({ type: 'send_reminder', customerName: 'Ramesh' });
  });

  it('returns unknown for empty input and chatter', () => {
    expect(parseCommand('   ')).toEqual({ type: 'unknown' });
    expect(parseCommand('hmm')).toEqual({ type: 'unknown' });
    expect(parseCommand('haan theek hai')).toEqual({ type: 'unknown' });
  });
});

describe('parseAmount', () => {
  it.each([
    ['500', 500],
    ['paanch sau', 500],
    ['do hazaar paanch sau', 2500],
    ['dedh hazaar', 1500],
    ['₹1,985', 1985],
  ])('%s -> %d', (phrase, expected) => {
    expect(parseAmount(phrase)).toBe(expected);
  });
});
