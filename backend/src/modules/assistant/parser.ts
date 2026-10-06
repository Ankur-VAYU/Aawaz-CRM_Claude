import { transliterate } from '../../lib/translit.js';

/**
 * Rule-based parser for the shopkeeper's spoken/typed Hinglish commands (romanised Hindi),
 * e.g. "Ramesh ko paanch kilo atta, do sarson tel… udhaar mein likh do".
 *
 * It only extracts structure (intent, names, quantities). Matching names against the store's
 * catalogue and customers happens later, in the bill service.
 */

export type MeasureUnit = 'kg' | 'g' | 'l' | 'ml';
export interface Measure {
  value: number;
  unit: MeasureUnit;
}

export interface ParsedLine {
  raw: string;
  name: string;
  /** Number of packs/pieces, if said ("do sarson tel" -> 2). */
  count: number | null;
  /** Weight/volume, if said ("paanch kilo atta" -> 5 kg). */
  measure: Measure | null;
  /** Speech recogniser marked part of the line as not understood ("m…l?"). */
  unclear: boolean;
}

export type PaymentMode = 'cash' | 'upi' | 'udhaar';

export type Intent =
  | {
      type: 'create_bill';
      customerName: string | null;
      paymentMode: PaymentMode;
      lines: ParsedLine[];
      /** Paid now on an udhaar bill ("500 abhi diye, baaki udhaar"), in paise. */
      upfront?: { amount: number; method: 'cash' | 'upi' };
    }
  | { type: 'query_balance'; customerName: string }
  | { type: 'record_payment'; customerName: string; amount: number; method: 'cash' | 'upi' }
  | { type: 'send_reminder'; customerName: string }
  | { type: 'list_customers' }
  | { type: 'daily_summary' }
  | { type: 'low_stock' }
  /** "Maal aaya: 20 bag atta, 10 sarson tel" — stock received from a supplier. */
  | { type: 'stock_in'; supplier: string | null; lines: ParsedLine[] }
  | { type: 'unknown' };

const NUMBER_WORDS: Record<string, number> = {
  ek: 1, aek: 1, one: 1, do: 2, two: 2, teen: 3, tin: 3, three: 3, char: 4, chaar: 4, four: 4,
  paanch: 5, panch: 5, paach: 5, five: 5, chhe: 6, chhah: 6, chah: 6, che: 6, six: 6,
  saat: 7, sat: 7, seven: 7, aath: 8, ath: 8, eight: 8, nau: 9, nine: 9, das: 10, dus: 10, ten: 10,
  gyarah: 11, gyaarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  satrah: 17, atharah: 18, athaarah: 18, unnis: 19, unnees: 19, bees: 20, bis: 20, pachchis: 25, pachees: 25, pachchees: 25, tees: 30,
  chalis: 40, chalees: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  aadha: 0.5, adha: 0.5, aadhi: 0.5, half: 0.5, paav: 0.25, pav: 0.25, paune: 0.75,
  dedh: 1.5, dhedh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, dhaee: 2.5,
  // English
  a: 1, an: 1, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, quarter: 0.25, dozen: 12,
};
const MULTIPLIERS: Record<string, number> = { sau: 100, so: 100, hundred: 100, hazaar: 1000, hazar: 1000, hajar: 1000, thousand: 1000 };

const UNIT_WORDS: Record<string, MeasureUnit | 'pc'> = {
  kilo: 'kg', kilos: 'kg', kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kgram: 'kg',
  gram: 'g', grams: 'g', gm: 'g', gms: 'g', g: 'g', gr: 'g',
  litre: 'l', liter: 'l', litres: 'l', liters: 'l', ltr: 'l', l: 'l', lit: 'l',
  ml: 'ml', mililitre: 'ml', millilitre: 'ml', milliliter: 'ml',
  packet: 'pc', packets: 'pc', pack: 'pc', pkt: 'pc', pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc',
  nag: 'pc', dabba: 'pc', dabbe: 'pc', bottle: 'pc', bottles: 'pc', bag: 'pc', bags: 'pc', bori: 'pc', x: 'pc',
  packs: 'pc', box: 'pc', boxes: 'pc', tin: 'pc', tins: 'pc', jar: 'pc', jars: 'pc', unit: 'pc', units: 'pc',
};

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

function clean(text: string): string {
  return transliterate(text)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\.{2,}/g, '…') // NFKC turns "…" into "..."; keep it as one "unclear" marker
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .replace(/[“”"«»]/g, ' ')
    .replace(/₹\s*/g, ' ₹')
    .replace(/×/g, ' x ')
    // "5kg" -> "5 kg", "500ml" -> "500 ml"
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const parseNumberToken = (tok: string): number | null => {
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  if (/^\d+\/\d+$/.test(tok)) {
    const [a, b] = tok.split('/').map(Number);
    return b ? a / b : null;
  }
  return NUMBER_WORDS[tok] ?? null;
};

/** Parses money-style phrases: "500", "paanch sau", "do hazaar paanch sau", "1,200". */
export function parseAmount(phrase: string): number | null {
  const tokens = clean(phrase).replace(/₹/g, ' ').replace(/(\d),(\d)/g, '$1$2').split(' ').filter(Boolean);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const tok of tokens) {
    const n = parseNumberToken(tok);
    if (n !== null) {
      current += n;
      seen = true;
      continue;
    }
    const m = MULTIPLIERS[tok];
    if (m) {
      current = (current || 1) * m;
      if (m >= 1000) {
        total += current;
        current = 0;
      }
      seen = true;
      continue;
    }
    if (['rupaye', 'rupay', 'rupees', 'rupee', 'rs', 'rupiya', 'rupiye', 'aur'].includes(tok)) continue;
    if (seen) break;
  }
  return seen ? total + current : null;
}

/** Splits "atta 5 kg" / "5 kg atta" / "2 x sarson tel 1 litre" into name, count and measure. */
export function parseLine(raw: string): ParsedLine | null {
  // Recognisers mark unheard parts inside a word ("m…l?") or as "??"; a trailing "…" is just a pause.
  const unclear = /\p{L}(…|\.\.\.)\p{L}|\?\?|\[\?\]/u.test(raw);
  const tokens = clean(raw)
    .replace(/[?…]+|\.\.\./g, ' ')
    .replace(/[,;]/g, ' ')
    .split(' ')
    .filter(Boolean);

  const groups: { value: number; unit: MeasureUnit | 'pc' | null }[] = [];
  const nameTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let n = parseNumberToken(tokens[i]);
    if (n !== null) {
      // "paanch sau gram" -> 500 g
      while (MULTIPLIERS[tokens[i + 1]]) n *= MULTIPLIERS[tokens[++i]];
      const unit = UNIT_WORDS[tokens[i + 1]] ?? null;
      groups.push({ value: n, unit });
      if (unit) i++;
      continue;
    }
    // A unit with no number before it ("kilo cheeni") means one unit.
    const unit = UNIT_WORDS[tokens[i]];
    if (unit && unit !== 'pc' && tokens[i].length > 1) {
      groups.push({ value: 1, unit });
      continue;
    }
    if (['x', 'wala', 'wali', 'vala', 'of'].includes(tokens[i])) continue;
    nameTokens.push(tokens[i]);
  }
  const name = nameTokens.join(' ').trim();
  if (!name && !unclear) return null;

  let count: number | null = null;
  let measure: Measure | null = null;
  for (const g of groups) {
    if (g.unit && g.unit !== 'pc') measure ??= { value: g.value, unit: g.unit };
    else count ??= g.value;
  }
  return { raw: raw.trim(), name, count, measure, unclear };
}

const CREDIT_RE = /\b(udhaar|udhar|udhari|khate|khata|khaate|baad me|baad mein|credit|on account|his account|her account|their account|pay later)\b/;
// English filler around a bill ("on credit", "put it on his account", "please").
const EN_FILLER_RE =
  /\b(put (it )?|add (it )?|write (it )?)?(on|in|to) (credit|account|his account|her account|their account|khata)\b|\b(on credit|pay later|please|bill|make a bill|make bill)\b|\b(by|via|through|in|with) (upi|cash|online|gpay|phonepe|paytm)\b/g;
const UPI_RE = /\b(upi|online|gpay|google pay|phonepe|phone pe|paytm|qr)\b/;
const FILLER_RE =
  /\b(udhaar|udhar|udhari|khate|khaate|khata|credit)\s*(me|mein|main|par|pe)?\s*(likh|daal|dal|jod|chadha)?\s*(do|dijiye|dena|de)?\b|\b(upi|online|gpay|phonepe|paytm|cash|nakad)\s*(se|me|mein|main)?\s*(diye|diya|payment)?\b|\b(likh|likho|likh do|bill bana|bill banao|bana do|banao|de do|dena|do na|dijiye|chahiye|please|plz|ka bill|ke liye)\b/g;

// "500 abhi diye", "do sau cash mein diye", "300 UPI se mile"
const AMOUNT_WORDS = `(?:\\d[\\d,]*(?:\\.\\d+)?|\\b(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(MULTIPLIERS)].join('|')})\\b)`;
const UPFRONT_RE = new RegExp(
  `(?:₹\\s*)?((?:${AMOUNT_WORDS}\\s*)+)\\s*(?:rupaye|rupay|rupees|rs)?\\s*(abhi|nakad|cash|upi|online|gpay|phonepe|paytm)?\\s*(?:se|me|mein|main)?\\s*(?:de diye|diye|diya|di|mile|mila|jama kiye|jama)\\b`,
);
// "paid 50 now", "gave 200 by upi"
const UPFRONT_EN_RE = new RegExp(
  `\\b(?:paid|gave|given|has paid)\\s+((?:${AMOUNT_WORDS}\\s*)+)\\s*(?:rupees|rs)?\\s*(?:now)?\\s*(?:(?:by|via|in|through)\\s+)?(upi|cash|online|gpay|phonepe|paytm)?\\s*(?:now)?\\b`,
);
// Words that are left over after removing a part payment and must not become bill lines.
const LEFTOVER_WORDS = new Set([
  'baaki', 'baki', 'bacha', 'bache', 'bas', 'abhi', 'aur', 'hai', 'ka', 'ki', 'ke',
  'rest', 'remaining', 'balance', 'now', 'the', 'and', 'it', 'is', 'give', 'gave', 'sell', 'sold',
]);

// "maal aaya", "Gupta Traders se maal aaya", "stock jodo", "naya stock aaya"
const STOCK_IN_RE =
  /^(?:(.+?)\s+se\s+)?(?:naya\s+)?(?:maal|stock|saamaan|saman)\s+(?:aaya hai|aa gaya|aagaya|aa gaye|aaya|aya|aaye|aye|mila|jodo|joda|daalo|dalo|add karo|add|in)\b[\s:,-]*/;

// "stock received: ...", "received stock from Gupta Traders: ...", "new stock arrived ..."
const STOCK_IN_EN_RE =
  /^(?:(?:received|got)\s+(?:new\s+)?(?:stock|goods|items|maal)|(?:new\s+)?(?:stock|goods|maal)\s+(?:received|arrived|came|has come|in))(?:\s+from\s+([^:,]+?))?\s*(?=[:,]|\s+\d|$)[\s:,-]*/;

/**
 * English bill phrasing: "give Ramesh 2 kg sugar", "for Ramesh: 2 kg sugar", "2 kg sugar for Ramesh
 * on credit". Returns the customer name and the rest of the sentence.
 */
function englishBillCustomer(text: string): { name: string; body: string } | null {
  const isQty = (w: string) => parseNumberToken(w) !== null;
  const prefix = text.match(/^(?:give|sell to|bill for|bill to|for|to)\s+(.+)$/);
  if (prefix) {
    const words = prefix[1].replace(/[:,]/g, ' , ').split(/\s+/).filter(Boolean);
    const stop = words.findIndex((w) => w === ',' || isQty(w));
    if (stop > 0) {
      const name = cleanName(words.slice(0, stop).join(' '));
      if (name) return { name, body: words.slice(stop).join(' ') };
    }
  }
  const suffix = text.match(/^(.*?)\s+(?:for|to)\s+([\p{L} .]+?)(?=\s+(?:on credit|on account|in credit|credit|udhaar|by upi|in cash|cash|upi|please|paid|gave)\b|[.,!?]?\s*$)(.*)$/u);
  if (suffix) {
    const name = cleanName(suffix[2]);
    if (name) return { name, body: `${suffix[1]} ${suffix[3]}` };
  }
  return null;
}

function splitLines(body: string): ParsedLine[] {
  return body
    .split(/,|;|…(?=\s|$)|\baur\b|\band\b|\bphir\b|\bek aur\b|\.(?!\d)/)
    .map((s) => s.trim())
    .filter((s) => s && s.replace(/[\s…?]/g, '').length > 0)
    .map(parseLine)
    .filter((l): l is ParsedLine => l !== null)
    .filter((l) => l.unclear || l.count !== null || l.measure !== null || !l.name.split(' ').every((w) => LEFTOVER_WORDS.has(w)));
}

const NAME_STOPWORDS = new Set(['aaj', 'abhi', 'jaldi', 'mujhe', 'hume', 'humko', 'mera', 'meri']);

function cleanName(name: string): string | null {
  const words = clean(name)
    .replace(/[^\p{L}\s.]/gu, ' ')
    .split(' ')
    .filter((w) => w && !NAME_STOPWORDS.has(w));
  if (!words.length || words.length > 4) return null;
  if (words.some((w) => parseNumberToken(w) !== null || UNIT_WORDS[w])) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function parseCommand(input: string): Intent {
  const text = clean(input);
  if (!text) return { type: 'unknown' };

  const stockIn = text.match(STOCK_IN_RE);
  if (stockIn) {
    const lines = splitLines(text.slice(stockIn[0].length));
    if (lines.length) {
      const supplier = stockIn[1] ? cleanName(stockIn[1]) : null;
      return { type: 'stock_in', supplier, lines };
    }
  }

  const stockInEn = text.match(STOCK_IN_EN_RE);
  if (stockInEn) {
    const lines = splitLines(text.slice(stockInEn[0].length));
    if (lines.length) return { type: 'stock_in', supplier: stockInEn[1] ? cleanName(stockInEn[1]) : null, lines };
  }

  if (/\b(show|list|all)\b.*\bcustomers?\b|\bcustomers? list\b|\bmy customers\b/.test(text)) {
    return { type: 'list_customers' };
  }
  if (/\btoday'?s? (sales|summary|report|business|total)\b|\b(sales|summary|report) (for |of )?today\b|\bdaily (summary|report)\b|\bhow much (did i|did we|have i) (sell|sold|earn)/.test(text)) {
    return { type: 'daily_summary' };
  }
  if (/\blow stock\b|\bstock (is )?(low|running out|finishing)\b|\brunning (out|low)\b|\bwhat (to|should i|do i need to) (buy|order|reorder)\b|\b(purchase|shopping|reorder) list\b/.test(text)) {
    return { type: 'low_stock' };
  }
  {
    const en =
      text.match(/^(?:please\s+)?(?:remind|send (?:a )?reminder to)\s+(.+?)(?:\s+(?:about|to pay|for)\b.*)?$/) ??
      null;
    const name = en ? cleanName(en[1]) : null;
    if (name) return { type: 'send_reminder', customerName: name };
  }
  {
    const en =
      text.match(/^how much (?:does|do|is|money (?:does|is))?\s*(.+?)\s+(?:owe|owes|have to pay|has to pay|due|pending)\b/) ??
      text.match(/^(?:what is |what's |show |check |tell me )?(.+?)(?:'s|s')\s+(?:balance|due|dues|account|khata|ledger|total)\b/) ??
      text.match(/^(?:show |check )?(?:balance|dues?|account|khata|ledger) (?:of|for) (.+?)\??$/);
    const name = en ? cleanName(en[1]) : null;
    if (name) return { type: 'query_balance', customerName: name };
  }
  {
    const paidBy = text.match(/^(.+?)\s+(?:paid|has paid|gave|deposited|returned)\s+(?:me\s+|us\s+)?(.+?)(?:\s+(?:rupees|rs)\b.*|\s+(?:by|via|through|in|on)\s+.*|\s+(?:cash|upi|online)\b.*)?$/);
    const gotFrom = text.match(/^(?:received|got|collected)\s+(.+?)\s+(?:rupees\s+|rs\s+)?from\s+(.+?)(?:\s+(?:by|via|through|in|on)\s+.*|\s+(?:cash|upi|online)\b.*)?$/);
    const name = paidBy ? cleanName(paidBy[1]) : gotFrom ? cleanName(gotFrom[2]) : null;
    const amountRupees = paidBy ? parseAmount(paidBy[2]) : gotFrom ? parseAmount(gotFrom[1]) : null;
    if (name && amountRupees && amountRupees > 0) {
      return { type: 'record_payment', customerName: name, amount: Math.round(amountRupees * 100), method: UPI_RE.test(text) ? 'upi' : 'cash' };
    }
  }

  if (/\b(grahak|graahak|grahakon|customer|customers)\b.*\b(list|suchi|dikhao|dikha|batao)\b/.test(text)) {
    return { type: 'list_customers' };
  }
  if (/\b(aaj|aj)\s+(ka|ki|ke)\s+(hisaab|hisab|bikri|bikree|summary|kamai|sale)\b|^(summary|daily summary|din ka hisaab)$/.test(text)) {
    return { type: 'daily_summary' };
  }
  if (/\b(stock|maal|saamaan|saman)\b.*\b(kam|khatam|low)\b|\bkharid list\b|\bkya (mangana|mangwana|lana)\b/.test(text)) {
    return { type: 'low_stock' };
  }

  let m = text.match(/^(.+?)\s+(ko|ka|ke)\s+(yaad dilao|yaad dilaao|yaad dila do|reminder)\b/);
  if (m) {
    const name = cleanName(m[1]);
    if (name) return { type: 'send_reminder', customerName: name };
  }

  m = text.match(/^(.+?)\s+(ka|ki|ke)\s+(kitna|kitne|kitni)\s+(baaki|baki|bakaya|udhaar|udhar|paisa|paise|hisaab|hisab)\b/)
    ?? text.match(/^(.+?)\s+(ka|ki|ke)\s+(khata|khaata|hisaab|hisab)\b/);
  if (m) {
    const name = cleanName(m[1]);
    if (name) return { type: 'query_balance', customerName: name };
  }

  m = text.match(/^(.+?)\s+(ne|se)\s+(.+?)\s+(diye|de diye|diya|di|jama kiye|jama kiya|jama|lautaye|wapas kiye|chukaye|mile|mila|aaye|aaya)\b/);
  if (m) {
    const name = cleanName(m[1]);
    const amountRupees = parseAmount(m[3]);
    if (name && amountRupees && amountRupees > 0) {
      return {
        type: 'record_payment',
        customerName: name,
        amount: Math.round(amountRupees * 100),
        method: UPI_RE.test(text) ? 'upi' : 'cash',
      };
    }
  }

  // Everything else is treated as a bill.
  const paymentMode: PaymentMode = CREDIT_RE.test(text) ? 'udhaar' : UPI_RE.test(text) ? 'upi' : 'cash';
  let body = input;
  let customerName: string | null = null;
  const nameMatch = clean(input).match(/^(.+?)\s+(ko|ke liye|ke naam|ka bill|ke khate mein|ke khate me)\s+(.*)$/);
  if (nameMatch) {
    const name = cleanName(nameMatch[1]);
    if (name) {
      customerName = name;
      body = nameMatch[3];
    }
  }
  if (!customerName) {
    const en = englishBillCustomer(clean(input));
    if (en) {
      customerName = en.name;
      body = en.body;
    }
  }
  body = clean(body);
  let upfront: { amount: number; method: 'cash' | 'upi' } | undefined;
  if (paymentMode === 'udhaar') {
    const paid = body.match(UPFRONT_RE) ?? body.match(UPFRONT_EN_RE);
    const rupees = paid ? parseAmount(paid[1]) : null;
    if (paid && rupees && rupees > 0) {
      upfront = { amount: Math.round(rupees * 100), method: paid[2] && UPI_RE.test(paid[2]) ? 'upi' : 'cash' };
      body = body.replace(paid[0], ' ');
    }
  }
  const lines = splitLines(body.replace(EN_FILLER_RE, ' ').replace(FILLER_RE, ' '));

  if (!lines.length) return { type: 'unknown' };
  // Without a quantity, a customer or a payment word, a lone word ("hmm", "haan") isn't a bill.
  const looksLikeBill =
    customerName !== null || CREDIT_RE.test(text) || UPI_RE.test(text) || lines.some((l) => l.count !== null || l.measure !== null || l.unclear);
  if (!looksLikeBill) return { type: 'unknown' };
  return { type: 'create_bill', customerName, paymentMode, lines, ...(upfront ? { upfront } : {}) };
}
