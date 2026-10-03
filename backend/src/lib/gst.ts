const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const isValidPan = (pan: string) => PAN_RE.test(pan);

/** Validates format and the GSTIN check digit (mod-36 Luhn variant). */
export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_RE.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(gstin[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return CHARSET[check] === gstin[14];
}

/** Characters 3–12 of a GSTIN are the holder's PAN. */
export const panFromGstin = (gstin: string) => gstin.slice(2, 12);

// GST state codes (first two digits of a GSTIN).
const STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

export const stateFromGstin = (gstin: string): string | null => STATE_CODES[gstin.slice(0, 2)] ?? null;

/* ---------- Invoices ---------- */

export type DocType = 'tax_invoice' | 'bill_of_supply' | 'bill';

/**
 * Which document a shop issues:
 * - GST-registered, regular scheme -> tax invoice (with CGST/SGST or IGST)
 * - GST-registered, composition scheme -> bill of supply (no tax may be charged)
 * - not registered -> plain bill (no GSTIN, no tax)
 */
export function documentTypeFor(store: { gstin: string | null; gstScheme: 'regular' | 'composition' | null }): DocType {
  if (!store.gstin || !store.gstScheme) return 'bill';
  return store.gstScheme === 'regular' ? 'tax_invoice' : 'bill_of_supply';
}

/** Indian financial year label for a local date, e.g. 2026-10-03 -> "2026-27". */
export function financialYear(localDate: string): string {
  const [y, m] = localDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "2026-27/0142" (max 16 characters, unique per financial year). */
export const invoiceNumber = (fy: string, seq: number) => `${fy}/${String(seq).padStart(4, '0')}`;

export interface LineTax {
  amount: number; // what the customer pays (paise)
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * Splits a line into taxable value and GST. With tax-inclusive prices (MRP) the customer pays
 * `gross`; otherwise tax is added on top. Intra-state sales split tax equally into CGST + SGST.
 */
export function lineTax(gross: number, ratePercent: number, opts: { inclusive: boolean; interState: boolean }): LineTax {
  let taxableValue: number;
  let tax: number;
  if (opts.inclusive) {
    taxableValue = Math.round((gross * 100) / (100 + ratePercent));
    tax = gross - taxableValue;
  } else {
    taxableValue = gross;
    tax = Math.round((gross * ratePercent) / 100);
  }
  const amount = taxableValue + tax;
  if (opts.interState) return { amount, taxableValue, cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.round(tax / 2);
  return { amount, taxableValue, cgst, sgst: tax - cgst, igst: 0 };
}

/** Customer in another state (by GSTIN state code) -> IGST. Over-the-counter retail sales are intra-state. */
export function isInterState(storeGstin: string | null, customerGstin: string | null): boolean {
  return Boolean(storeGstin && customerGstin && storeGstin.slice(0, 2) !== customerGstin.slice(0, 2));
}
