/**
 * Devanagari → romanised Hinglish, so "रमेश को पांच किलो आटा" reads like "ramesh ko paanch kilo aata".
 * Phone speech recognisers return Hindi in Devanagari; the parser and catalogue work in Roman script.
 *
 * Rules: consonants carry an inherent "a" which is dropped at the end of a word and in the common
 * medial case (vowel–consonant–consonant+vowel: कितना → kitna, सरसों → sarson). Long vowels at the
 * end of a word are shortened (आटा → aata, चीनी → cheeni), as people type them.
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e',
};
const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e',
};
const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'य़': 'y',
};
const NUKTA = '़';
const VIRAMA = '्';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const DIGITS = '०१२३४५६७८९';

interface Unit {
  cons?: string; // consonant sound
  vowel: string; // vowel sound ('' after virama)
  inherent: boolean; // vowel is the implicit "a"
  nasal: boolean;
}

function syllables(word: string): Unit[] {
  const chars = [...word.normalize('NFC')];
  const out: Unit[] = [];
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (chars[i + 1] === NUKTA) {
      ch += NUKTA;
      i++;
    }
    if (CONSONANTS[ch] !== undefined) {
      const next = chars[i + 1];
      if (next === VIRAMA) {
        out.push({ cons: CONSONANTS[ch], vowel: '', inherent: false, nasal: false });
        i++;
      } else if (next && MATRAS[next] !== undefined) {
        out.push({ cons: CONSONANTS[ch], vowel: MATRAS[next], inherent: false, nasal: false });
        i++;
      } else {
        out.push({ cons: CONSONANTS[ch], vowel: 'a', inherent: true, nasal: false });
      }
    } else if (VOWELS[ch] !== undefined) {
      out.push({ vowel: VOWELS[ch], inherent: false, nasal: false });
    } else if ((ch === ANUSVARA || ch === CHANDRABINDU) && out.length) {
      out[out.length - 1].nasal = true;
    } else if (ch === VISARGA) {
      out.push({ vowel: 'h', inherent: false, nasal: false });
    }
  }
  return out;
}

function transliterateWord(word: string): string {
  const u = syllables(word);
  if (!u.length) return '';
  // Drop the inherent vowel at the end of the word (रमेश → ramesh, not ramesha).
  const last = u[u.length - 1];
  if (last.inherent && u.length > 1 && !last.nasal) last.vowel = '';
  // Medial schwa deletion: V C(a) C+V → drop the "a" (कितना → kitna, सरसों → sarson).
  for (let i = 1; i < u.length - 1; i++) {
    const prevEndsInVowel = u[i - 1].vowel !== '';
    const next = u[i + 1];
    if (u[i].inherent && !u[i].nasal && prevEndsInVowel && next.cons && next.vowel && !next.inherent) {
      u[i].vowel = '';
    }
  }
  let s = '';
  u.forEach((x, i) => {
    let v = x.vowel;
    const final = i === u.length - 1;
    if (final && v === 'aa') v = 'a';
    if (final && v === 'ee') v = 'i';
    if (x.nasal) v = final && v === 'e' ? 'ein' : `${v}n`; // में → mein, पांच → paanch
    s += (x.cons ?? '') + v;
  });
  return s;
}

// English loanwords as Hindi speech recognisers spell them, and a few words whose spoken form
// differs from the letter-by-letter reading.
const WORDS: Record<string, string> = {
  'यूपीआई': 'upi', 'यूपीआइ': 'upi', 'ऑनलाइन': 'online', 'कैश': 'cash', 'नकद': 'nakad', 'पेटीएम': 'paytm',
  'फोनपे': 'phonepe', 'गूगल': 'google', 'पे': 'pay',
  'स्टॉक': 'stock', 'स्टाक': 'stock', 'लिस्ट': 'list', 'बिल': 'bill', 'समरी': 'summary',
  'किलो': 'kilo', 'केजी': 'kg', 'ग्राम': 'gram', 'लीटर': 'litre', 'लिटर': 'litre', 'एमएल': 'ml',
  'बैग': 'bag', 'बोरी': 'bori', 'पैकेट': 'packet', 'पैकेट्स': 'packets', 'बोतल': 'bottle', 'डिब्बा': 'dabba', 'डिब्बे': 'dabbe',
  'दिए': 'diye', 'दिये': 'diye', 'लिए': 'liye', 'लिये': 'liye', 'गए': 'gaye', 'आए': 'aaye',
  'मैगी': 'maggi', 'बिस्कुट': 'biscuit', 'साबुन': 'sabun',
};

export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

export function transliterate(text: string): string {
  if (!hasDevanagari(text)) return text;
  return text
    .replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)))
    .replace(/।/g, '.')
    .replace(/[ऀ-ॿ]+/g, (w) => WORDS[w.normalize('NFC')] ?? transliterateWord(w));
}
