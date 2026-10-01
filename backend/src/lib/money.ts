/** Formats paise as Indian rupees, e.g. 198500 -> "₹1,985", 12345 -> "₹123.45". */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = rupees.toLocaleString('en-IN') + (rem ? `.${String(rem).padStart(2, '0')}` : '');
  return `${negative ? '−' : ''}₹${body}`;
}

/** Multiplies a price in paise by a (possibly fractional) quantity, rounding to the nearest paisa. */
export const lineAmount = (unitPrice: number, quantity: number) => Math.round(unitPrice * quantity);
