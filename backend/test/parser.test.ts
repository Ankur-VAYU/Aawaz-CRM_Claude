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

  it('reads a part payment on an udhaar bill', () => {
    const intent = parseCommand('Ramesh ko paanch kilo atta, ek kilo toor dal, 200 abhi diye baaki udhaar mein likh do');
    expect(intent).toMatchObject({ type: 'create_bill', paymentMode: 'udhaar', upfront: { amount: 20000, method: 'cash' } });
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map((l) => l.name)).toEqual(['atta', 'toor dal']);

    const upi = parseCommand('Sunita ko do kilo cheeni, teen sau UPI se diye, baaki khate mein');
    expect(upi).toMatchObject({ upfront: { amount: 30000, method: 'upi' } });
    if (upi.type !== 'create_bill') throw new Error();
    expect(upi.lines.map((l) => l.name)).toEqual(['cheeni']);
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

  it('stock received ("maal aaya")', () => {
    const intent = parseCommand('Maal aaya: 20 bag atta, 10 sarson tel 1 litre aur paanch kilo cheeni');
    expect(intent).toMatchObject({ type: 'stock_in', supplier: null });
    if (intent.type !== 'stock_in') throw new Error();
    expect(intent.lines.map((l) => [l.name, l.count, l.measure])).toEqual([
      ['atta', 20, null],
      ['sarson tel', 10, { value: 1, unit: 'l' }],
      ['cheeni', null, { value: 5, unit: 'kg' }],
    ]);
    expect(parseCommand('Gupta Traders se maal aaya 12 toor dal')).toMatchObject({ type: 'stock_in', supplier: 'Gupta Traders' });
    expect(parseCommand('गुप्ता ट्रेडर्स से माल आया बीस बैग आटा')).toMatchObject({ type: 'stock_in' });
    // Low stock is a different question
    expect(parseCommand('kaunsa stock kam hai')).toEqual({ type: 'low_stock' });
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

import { financialYear, invoiceNumber, isInterState, lineTax } from '../src/lib/gst.js';

describe('GST helpers', () => {
  it('financial year runs April to March', () => {
    expect(financialYear('2026-10-03')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(invoiceNumber('2026-27', 142)).toBe('2026-27/0142');
  });

  it('splits tax-inclusive prices into taxable value + CGST/SGST', () => {
    // ₹245 MRP at 5%: taxable 233.33, tax 11.67
    expect(lineTax(24500, 5, { inclusive: true, interState: false })).toEqual({
      amount: 24500,
      taxableValue: 23333,
      cgst: 584,
      sgst: 583,
      igst: 0,
    });
  });

  it('adds tax on top for exclusive prices, and uses IGST across states', () => {
    expect(lineTax(10000, 18, { inclusive: false, interState: true })).toEqual({
      amount: 11800,
      taxableValue: 10000,
      cgst: 0,
      sgst: 0,
      igst: 1800,
    });
    expect(isInterState('09ABCDE1234F1Z5', '27ABCDE1234F1Z5')).toBe(true);
    expect(isInterState('09ABCDE1234F1Z5', null)).toBe(false);
  });

  it('zero-rated items have no tax', () => {
    expect(lineTax(6000, 0, { inclusive: true, interState: false })).toMatchObject({ taxableValue: 6000, cgst: 0, sgst: 0 });
  });
});

import { transliterate } from '../src/lib/translit.js';

describe('Hindi script (what phone speech recognition returns)', () => {
  it('transliterates Devanagari to Hinglish', () => {
    expect(transliterate('रमेश का कितना बाकी है')).toBe('ramesh ka kitna baaki hai');
    expect(transliterate('दो सरसों तेल उधार में लिख दो')).toBe('do sarson tel udhaar mein likh do');
    expect(transliterate('already roman')).toBe('already roman');
  });

  it('parses the main voice bill spoken in Hindi', () => {
    const intent = parseCommand('रमेश को पांच किलो आटा, एक किलो तूर दाल, दो सरसों तेल उधार में लिख दो');
    expect(intent).toMatchObject({ type: 'create_bill', customerName: 'Ramesh', paymentMode: 'udhaar' });
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map((l) => [l.name, l.count, l.measure])).toEqual([
      ['aata', null, { value: 5, unit: 'kg' }],
      ['toor daal', null, { value: 1, unit: 'kg' }],
      ['sarson tel', 2, null],
    ]);
  });

  it.each([
    ['रमेश ने पांच सौ रुपये दिए यूपीआई से', { type: 'record_payment', amount: 50000, method: 'upi' }],
    ['ग्राहक लिस्ट दिखाओ', { type: 'list_customers' }],
    ['आज का हिसाब', { type: 'daily_summary' }],
    ['कौन सा स्टॉक कम है', { type: 'low_stock' }],
    ['रमेश को याद दिलाओ', { type: 'send_reminder', customerName: 'Ramesh' }],
    ['सुनीता को दो किलो चीनी, पचास अभी दिए बाकी उधार', { type: 'create_bill', upfront: { amount: 5000, method: 'cash' } }],
  ])('%s', (text, expected) => {
    expect(parseCommand(text)).toMatchObject(expected);
  });

  it('reads multipliers and loanword units', () => {
    const intent = parseCommand('पांच सौ ग्राम जीरा और एक पैकेट मैगी');
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map((l) => [l.name, l.count, l.measure])).toEqual([
      ['jeera', null, { value: 500, unit: 'g' }],
      ['maggi', 1, null],
    ]);
  });
});

describe('English commands', () => {
  it.each([
    ['Give Ramesh 5 kg atta, 1 kg toor dal and 2 mustard oil on credit', { type: 'create_bill', customerName: 'Ramesh', paymentMode: 'udhaar' }],
    ['2 kg sugar and half kg salt for Ramesh on credit', { type: 'create_bill', customerName: 'Ramesh', paymentMode: 'udhaar' }],
    ['For Sunita: 2 kg sugar, paid 50 now, rest on credit', { type: 'create_bill', customerName: 'Sunita', upfront: { amount: 5000, method: 'cash' } }],
    ['5 kg rice and a packet of maggi', { type: 'create_bill', customerName: null, paymentMode: 'cash' }],
    ['How much does Ramesh owe?', { type: 'query_balance', customerName: 'Ramesh' }],
    ["What's Sunita's balance", { type: 'query_balance', customerName: 'Sunita' }],
    ['Ramesh paid 500 by UPI', { type: 'record_payment', customerName: 'Ramesh', amount: 50000, method: 'upi' }],
    ['Received 300 rupees from Sunita in cash', { type: 'record_payment', customerName: 'Sunita', amount: 30000, method: 'cash' }],
    ['Show customers', { type: 'list_customers' }],
    ["Today's sales", { type: 'daily_summary' }],
    ['What should I buy', { type: 'low_stock' }],
    ['Remind Ramesh', { type: 'send_reminder', customerName: 'Ramesh' }],
    ['Received stock from Gupta Traders: 20 bags atta, 10 mustard oil 1 litre', { type: 'stock_in', supplier: 'Gupta Traders' }],
    ['hello', { type: 'unknown' }],
  ])('%s', (text, expected) => {
    expect(parseCommand(text)).toMatchObject(expected);
  });

  it('reads English quantities', () => {
    const intent = parseCommand('2 kg sugar and half kg salt for Ramesh on credit');
    if (intent.type !== 'create_bill') throw new Error();
    expect(intent.lines.map((l) => [l.name, l.measure])).toEqual([
      ['sugar', { value: 2, unit: 'kg' }],
      ['salt', { value: 0.5, unit: 'kg' }],
    ]);
  });
});
