/** Lower-cases and strips everything except letters, digits and single spaces. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapses common Hinglish spelling variation ("aata"/"atta", "daal"/"dal", "tel"/"teil"). */
export function phonetic(s: string): string {
  return normalizeText(s)
    .replace(/\s+/g, '')
    .replace(/(.)\1+/g, '$1') // doubled letters
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/([kgcjtdpb])h/g, '$1')
    .replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common, after phonetic normalisation. */
export function similarity(a: string, b: string): number {
  const pa = phonetic(a);
  const pb = phonetic(b);
  if (!pa || !pb) return 0;
  const longest = Math.max(pa.length, pb.length);
  return 1 - levenshtein(pa, pb) / longest;
}
