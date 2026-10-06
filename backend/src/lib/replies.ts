import { formatRupees as r } from './money.js';

export type Lang = 'hi' | 'hinglish' | 'en';
export const LANGS: Lang[] = ['hi', 'hinglish', 'en'];

/**
 * Short replies in the shop's chosen language: Hindi (Devanagari), Hinglish (romanised Hindi,
 * as in the design) or English. The Hindi copy should be reviewed by a native speaker.
 */
const templates = {
  billDraft: {
    hinglish: (v: { customer: string | null; count: number; total: number }) =>
      `${v.customer ? `${v.customer} ka bill` : 'Bill'} · ${v.count} item · ${r(v.total)}. Check karke pakka karein.`,
    hi: (v: { customer: string | null; count: number; total: number }) =>
      `${v.customer ? `${v.customer} का बिल` : 'बिल'} · ${v.count} आइटम · ${r(v.total)}। जाँच कर पक्का करें।`,
    en: (v: { customer: string | null; count: number; total: number }) =>
      `${v.customer ? `Bill for ${v.customer}` : 'Bill'} · ${v.count} item${v.count === 1 ? '' : 's'} · ${r(v.total)}. Check and confirm.`,
  },
  billNeedsInput: {
    hinglish: (v: { n: number }) => (v.n === 1 ? 'Ek cheez saaf nahi hui. Ek tap mein chuniye.' : `${v.n} cheezein saaf nahi hui. Chuniye.`),
    hi: (v: { n: number }) => (v.n === 1 ? 'एक चीज़ साफ़ नहीं हुई। एक टैप में चुनिए।' : `${v.n} चीज़ें साफ़ नहीं हुईं। चुनिए।`),
    en: (v: { n: number }) => (v.n === 1 ? 'One thing needs your answer. Pick with one tap.' : `${v.n} things need your answer. Please pick.`),
  },
  billConfirmed: {
    hinglish: () => 'Ho gaya, sab likh diya',
    hi: () => 'हो गया, सब लिख दिया',
    en: () => 'Done, all recorded',
  },
  stockReduced: {
    hinglish: (v: { n: number }) => `Stock se ${v.n} item kam kiye`,
    hi: (v: { n: number }) => `स्टॉक से ${v.n} आइटम कम किए`,
    en: (v: { n: number }) => `Reduced stock for ${v.n} item${v.n === 1 ? '' : 's'}`,
  },
  khataChanged: {
    hinglish: (v: { name: string; before: number; after: number }) => `${v.name} ka khata: ${r(v.before)} → ${r(v.after)}`,
    hi: (v: { name: string; before: number; after: number }) => `${v.name} का खाता: ${r(v.before)} → ${r(v.after)}`,
    en: (v: { name: string; before: number; after: number }) => `${v.name}'s balance: ${r(v.before)} → ${r(v.after)}`,
  },
  receiptSent: {
    hinglish: (v: { name: string }) => `Receipt ${v.name} ko bhej di`,
    hi: (v: { name: string }) => `रसीद ${v.name} को भेज दी`,
    en: (v: { name: string }) => `Receipt sent to ${v.name}`,
  },
  balance: {
    hinglish: (v: { name: string; balance: number }) =>
      v.balance > 0 ? `${v.name} ka kul baaki ${r(v.balance)} hai` : `${v.name} ka hisaab saaf hai`,
    hi: (v: { name: string; balance: number }) =>
      v.balance > 0 ? `${v.name} का कुल बाकी ${r(v.balance)} है` : `${v.name} का हिसाब साफ़ है`,
    en: (v: { name: string; balance: number }) =>
      v.balance > 0 ? `${v.name} owes ${r(v.balance)} in total` : `${v.name} has nothing due`,
  },
  paymentRecorded: {
    hinglish: (v: { name: string; amount: number; balance: number }) =>
      `${v.name} se ${r(v.amount)} mile. Ab baaki ${r(v.balance)}.`,
    hi: (v: { name: string; amount: number; balance: number }) =>
      `${v.name} से ${r(v.amount)} मिले। अब बाकी ${r(v.balance)}।`,
    en: (v: { name: string; amount: number; balance: number }) =>
      `Received ${r(v.amount)} from ${v.name}. Balance now ${r(v.balance)}.`,
  },
  reminderQueued: {
    hinglish: (v: { name: string }) => `${v.name} ko yaad dila diya`,
    hi: (v: { name: string }) => `${v.name} को याद दिला दिया`,
    en: (v: { name: string }) => `Reminder sent to ${v.name}`,
  },
  customerNotFound: {
    hinglish: (v: { name: string }) => `"${v.name}" naam ka grahak nahi mila`,
    hi: (v: { name: string }) => `"${v.name}" नाम का ग्राहक नहीं मिला`,
    en: (v: { name: string }) => `No customer named "${v.name}"`,
  },
  customerAmbiguous: {
    hinglish: (v: { name: string }) => `"${v.name}" naam ke ek se zyada grahak hain. Kaun?`,
    hi: (v: { name: string }) => `"${v.name}" नाम के एक से ज़्यादा ग्राहक हैं। कौन?`,
    en: (v: { name: string }) => `More than one customer is called "${v.name}". Which one?`,
  },
  customers: {
    hinglish: (v: { total: number; dues: number }) => `Aapke grahak · ${v.total}. Kul udhaar baaki ${r(v.dues)}`,
    hi: (v: { total: number; dues: number }) => `आपके ग्राहक · ${v.total}। कुल उधार बाकी ${r(v.dues)}`,
    en: (v: { total: number; dues: number }) => `Your customers · ${v.total}. Total credit due ${r(v.dues)}`,
  },
  summary: {
    hinglish: (v: { sales: number; bills: number }) => `Aaj ki bikri ${r(v.sales)} · ${v.bills} bill`,
    hi: (v: { sales: number; bills: number }) => `आज की बिक्री ${r(v.sales)} · ${v.bills} बिल`,
    en: (v: { sales: number; bills: number }) => `Today's sales ${r(v.sales)} · ${v.bills} bill${v.bills === 1 ? '' : 's'}`,
  },
  lowStock: {
    hinglish: (v: { n: number }) => (v.n ? `${v.n} item ka stock kam hai` : 'Sab item ka stock theek hai'),
    hi: (v: { n: number }) => (v.n ? `${v.n} आइटम का स्टॉक कम है` : 'सब आइटम का स्टॉक ठीक है'),
    en: (v: { n: number }) => (v.n ? `${v.n} item${v.n === 1 ? ' is' : 's are'} low on stock` : 'All items have enough stock'),
  },
  stockInPreview: {
    hinglish: (v: { matched: number; unmatched: number }) =>
      v.unmatched ? `${v.matched} item mile, ${v.unmatched} saaf nahi hue. Check karke pakka karein.` : `${v.matched} item ka maal. Check karke pakka karein.`,
    hi: (v: { matched: number; unmatched: number }) =>
      v.unmatched ? `${v.matched} आइटम मिले, ${v.unmatched} साफ़ नहीं हुए। जाँच कर पक्का करें।` : `${v.matched} आइटम का माल। जाँच कर पक्का करें।`,
    en: (v: { matched: number; unmatched: number }) =>
      v.unmatched ? `Found ${v.matched} item(s); ${v.unmatched} not recognised. Check and confirm.` : `Stock for ${v.matched} item(s). Check and confirm.`,
  },
  notUnderstood: {
    hinglish: () => 'Samajh nahi aaya. Phir se boliye, jaise: "Ramesh ko do kilo cheeni, udhaar mein likh do"',
    hi: () => 'समझ नहीं आया। फिर से बोलिए, जैसे: "रमेश को दो किलो चीनी, उधार में लिख दो"',
    en: () => 'Sorry, I did not get that. Try: "2 kg sugar for Ramesh on credit"',
  },
} as const;

type Templates = typeof templates;
export function reply<K extends keyof Templates>(
  lang: Lang,
  key: K,
  ...vars: Parameters<Templates[K]['hinglish']>
): string {
  const fn = (templates[key][lang] ?? templates[key].hinglish) as (...a: unknown[]) => string;
  return fn(...vars);
}

/* ---------- Messages sent to customers / owner on WhatsApp (in the shop's language) ---------- */

export function receiptMessage(v: {
  lang?: Lang;
  storeName: string;
  customerName: string;
  invoiceNumber: string;
  lines: { name: string; sizeLabel: string | null; quantity: number; amount: number }[];
  total: number;
  paidNow: number;
  credit: number;
  balance: number;
  link: string;
}): string {
  const lang = v.lang ?? 'hinglish';
  const lines = v.lines.map((l) => `• ${l.name}${l.sizeLabel ? ` ${l.sizeLabel}` : ''} × ${l.quantity} — ${r(l.amount)}`);
  const t = {
    hinglish: {
      hello: `Namaste ${v.customerName} ji`, title: 'Rasid', total: 'Total', paid: 'Abhi diye',
      credit: `Udhaar mein likha: ${r(v.credit)} · Aapka kul baaki: ${r(v.balance)}`, link: 'Poora hisaab',
      thanks: 'Dhanyavaad! Kisi galti ke liye dukaan par bataiye.',
    },
    hi: {
      hello: `नमस्ते ${v.customerName} जी`, title: 'रसीद', total: 'कुल', paid: 'अभी दिए',
      credit: `उधार में लिखा: ${r(v.credit)} · आपका कुल बाकी: ${r(v.balance)}`, link: 'पूरा हिसाब',
      thanks: 'धन्यवाद! किसी गलती के लिए दुकान पर बताइए।',
    },
    en: {
      hello: `Hello ${v.customerName}`, title: 'Receipt', total: 'Total', paid: 'Paid now',
      credit: `Added to your account: ${r(v.credit)} · Your total due: ${r(v.balance)}`, link: 'Full account',
      thanks: 'Thank you! Please tell the shop if anything is wrong.',
    },
  }[lang];
  return [
    t.hello,
    `${v.storeName} · ${t.title} · Bill ${v.invoiceNumber}`,
    ...lines,
    `${t.total}: ${r(v.total)}`,
    ...(v.paidNow > 0 ? [`${t.paid}: ${r(v.paidNow)}`] : []),
    t.credit,
    `${t.link}: ${v.link}`,
    t.thanks,
  ].join('\n');
}

export function reminderMessage(v: { lang?: Lang; storeName: string; customerName: string; balance: number; link: string }) {
  switch (v.lang ?? 'hinglish') {
    case 'hi':
      return `नमस्ते ${v.customerName} जी, ${v.storeName} में आपका बाकी ${r(v.balance)} है। हिसाब: ${v.link}`;
    case 'en':
      return `Hello ${v.customerName}, your balance at ${v.storeName} is ${r(v.balance)}. Details: ${v.link}`;
    default:
      return `Namaste ${v.customerName} ji, ${v.storeName} mein aapka baaki ${r(v.balance)} hai. Hisaab: ${v.link}`;
  }
}
