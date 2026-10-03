/**
 * Normalises a phone number to E.164. Bare 10-digit numbers (optionally with a 0 or 91 prefix)
 * are treated as Indian mobiles. Returns null when the input isn't a plausible number.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim().replace(/[\s\-().]/g, '');
  if (raw.startsWith('+')) {
    const digits = raw.slice(1);
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) return null;
    return `+${digits}`;
  }
  if (!/^\d+$/.test(raw)) return null;
  let local = raw;
  if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
  else if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}
