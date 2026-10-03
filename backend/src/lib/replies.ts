import { formatRupees as r } from './money.js';

export type Lang = 'hi' | 'hinglish';

/**
 * Short replies in the shopkeeper's chosen language. Hinglish copy follows the design; the Hindi
 * versions are first drafts and should be reviewed by a native speaker.
 */
const templates = {
  billDraft: {
    hinglish: (v: { customer: string | null; count: number; total: number }) =>
      `${v.customer ? `${v.customer} ka bill` : 'Bill'} · ${v.count} item · ${r(v.total)}. Check karke pakka karein.`,
    hi: (v: { customer: string | null; count: number; total: number }) =>
      `${v.customer ? `${v.customer} का बिल` : 'बिल'} · ${v.count} आइटम · ${r(v.total)}। जाँच कर पक्का करें।`,
  },
  billNeedsInput: {
    hinglish: (v: { n: number }) => (v.n === 1 ? 'Ek cheez saaf nahi hui. Ek tap mein chuniye.' : `${v.n} cheezein saaf nahi hui. Chuniye.`),
    hi: (v: { n: number }) => (v.n === 1 ? 'एक चीज़ साफ़ नहीं हुई। एक टैप में चुनिए।' : `${v.n} चीज़ें साफ़ नहीं हुईं। चुनिए।`),
  },
  billConfirmed: {
    hinglish: () => 'Ho gaya, sab likh diya',
    hi: () => 'हो गया, सब लिख दिया',
  },
  stockReduced: {
    hinglish: (v: { n: number }) => `Stock se ${v.n} item kam kiye`,
    hi: (v: { n: number }) => `स्टॉक से ${v.n} आइटम कम किए`,
  },
  khataChanged: {
    hinglish: (v: { name: string; before: number; after: number }) => `${v.name} ka khata: ${r(v.before)} → ${r(v.after)}`,
    hi: (v: { name: string; before: number; after: number }) => `${v.name} का खाता: ${r(v.before)} → ${r(v.after)}`,
  },
  receiptSent: {
    hinglish: (v: { name: string }) => `Receipt ${v.name} ko bhej di`,
    hi: (v: { name: string }) => `रसीद ${v.name} को भेज दी`,
  },
  balance: {
    hinglish: (v: { name: string; balance: number }) =>
      v.balance > 0 ? `${v.name} ka kul baaki ${r(v.balance)} hai` : `${v.name} ka hisaab saaf hai`,
    hi: (v: { name: string; balance: number }) =>
      v.balance > 0 ? `${v.name} का कुल बाकी ${r(v.balance)} है` : `${v.name} का हिसाब साफ़ है`,
  },
  paymentRecorded: {
    hinglish: (v: { name: string; amount: number; balance: number }) =>
      `${v.name} se ${r(v.amount)} mile. Ab baaki ${r(v.balance)}.`,
    hi: (v: { name: string; amount: number; balance: number }) =>
      `${v.name} से ${r(v.amount)} मिले। अब बाकी ${r(v.balance)}।`,
  },
  reminderQueued: {
    hinglish: (v: { name: string }) => `${v.name} ko yaad dila diya`,
    hi: (v: { name: string }) => `${v.name} को याद दिला दिया`,
  },
  customerNotFound: {
    hinglish: (v: { name: string }) => `"${v.name}" naam ka grahak nahi mila`,
    hi: (v: { name: string }) => `"${v.name}" नाम का ग्राहक नहीं मिला`,
  },
  customerAmbiguous: {
    hinglish: (v: { name: string }) => `"${v.name}" naam ke ek se zyada grahak hain. Kaun?`,
    hi: (v: { name: string }) => `"${v.name}" नाम के एक से ज़्यादा ग्राहक हैं। कौन?`,
  },
  customers: {
    hinglish: (v: { total: number; dues: number }) => `Aapke grahak · ${v.total}. Kul udhaar baaki ${r(v.dues)}`,
    hi: (v: { total: number; dues: number }) => `आपके ग्राहक · ${v.total}। कुल उधार बाकी ${r(v.dues)}`,
  },
  summary: {
    hinglish: (v: { sales: number; bills: number }) => `Aaj ki bikri ${r(v.sales)} · ${v.bills} bill`,
    hi: (v: { sales: number; bills: number }) => `आज की बिक्री ${r(v.sales)} · ${v.bills} बिल`,
  },
  lowStock: {
    hinglish: (v: { n: number }) => (v.n ? `${v.n} item ka stock kam hai` : 'Sab item ka stock theek hai'),
    hi: (v: { n: number }) => (v.n ? `${v.n} आइटम का स्टॉक कम है` : 'सब आइटम का स्टॉक ठीक है'),
  },
  notUnderstood: {
    hinglish: () => 'Samajh nahi aaya. Phir se boliye, jaise: "Ramesh ko do kilo cheeni, udhaar mein likh do"',
    hi: () => 'समझ नहीं आया। फिर से बोलिए, जैसे: "रमेश को दो किलो चीनी, उधार में लिख दो"',
  },
} as const;

type Templates = typeof templates;
export function reply<K extends keyof Templates>(
  lang: Lang,
  key: K,
  ...vars: Parameters<Templates[K]['hinglish']>
): string {
  const fn = templates[key][lang] as (...a: unknown[]) => string;
  return fn(...vars);
}

/* ---------- Messages sent to customers / owner on WhatsApp ---------- */

export function receiptMessage(v: {
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
  const lines = v.lines.map((l) => `• ${l.name}${l.sizeLabel ? ` ${l.sizeLabel}` : ''} × ${l.quantity} — ${r(l.amount)}`);
  return [
    `Namaste ${v.customerName} ji`,
    `${v.storeName} · Rasid · Bill ${v.invoiceNumber}`,
    ...lines,
    `Total: ${r(v.total)}`,
    ...(v.paidNow > 0 ? [`Abhi diye: ${r(v.paidNow)}`] : []),
    `Udhaar mein likha: ${r(v.credit)} · Aapka kul baaki: ${r(v.balance)}`,
    `Poora hisaab: ${v.link}`,
    'Dhanyavaad! Kisi galti ke liye dukaan par bataiye.',
  ].join('\n');
}

export function reminderMessage(v: { storeName: string; customerName: string; balance: number; link: string }) {
  return `Namaste ${v.customerName} ji, ${v.storeName} mein aapka baaki ${r(v.balance)} hai. Hisaab: ${v.link}`;
}
