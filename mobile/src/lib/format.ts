import type { Lang } from './types';

/** Paise → "₹1,245" (or "₹1,245.50" when there are paise). Indian digit grouping. */
export function rupees(paise: number) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const s = whole.toLocaleString('en-IN') + (frac ? `.${String(frac).padStart(2, '0')}` : '');
  return `${neg ? '−' : ''}₹${s}`;
}

/** Rupees typed by the user → number, or null if not a valid amount. */
export function parseRupees(text: string): number | null {
  const t = text.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

export function parseQty(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

const LOCALE: Record<Lang, string> = { hinglish: 'en-IN', hi: 'hi-IN', en: 'en-IN' };

export function shortDate(iso: string | null, lang: Lang) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(LOCALE[lang], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function qtyLabel(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function isValidMobile(text: string) {
  const d = text.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d);
}
