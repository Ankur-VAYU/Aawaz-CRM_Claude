import crypto from 'node:crypto';
import type { BillIssue, BillIssueOption, Item } from '../../db/schema.js';
import { lineAmount } from '../../lib/money.js';
import { itemDisplayName } from '../../lib/serialize.js';
import { phonetic, similarity } from '../../lib/text.js';
import type { Measure, ParsedLine } from '../assistant/parser.js';

const MATCH_THRESHOLD = 0.72;
const AMBIGUITY_MARGIN = 0.05;
const EPS = 1e-9;

export type ResolvedLine =
  | { kind: 'ok'; item: Item; quantity: number }
  | { kind: 'issue'; issue: BillIssue };

const toBase = (value: number, unit: string) => {
  switch (unit) {
    case 'g':
      return { dim: 'mass', v: value / 1000 };
    case 'kg':
      return { dim: 'mass', v: value };
    case 'ml':
      return { dim: 'vol', v: value / 1000 };
    case 'l':
      return { dim: 'vol', v: value };
    default:
      return { dim: 'count', v: value };
  }
};

const isWhole = (n: number) => Math.abs(n - Math.round(n)) < EPS;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * How many packs of `variant` correspond to what was said, or null if it doesn't fit.
 * "5 kg atta" + 5 kg bag -> 1; "10 kg" + 5 kg bag -> 2; "2.5 kg" + loose (1 kg) -> 2.5.
 */
export function quantityFor(variant: Pick<Item, 'unit' | 'unitSize'>, count: number | null, measure: Measure | null) {
  if (!measure) return count ?? 1;
  const said = toBase(measure.value, measure.unit);
  const pack = toBase(Number(variant.unitSize), variant.unit);
  if (said.dim !== pack.dim) return null;
  if (Math.abs(said.v - pack.v) < EPS) return count ?? 1;
  if (count === null && isWhole(said.v / pack.v) && said.v > pack.v) return round3(said.v / pack.v);
  if (Math.abs(pack.v - 1) < EPS) return round3(said.v * (count ?? 1)); // sold loose per kg / litre
  return null;
}

interface Product {
  key: string;
  name: string;
  variants: Item[];
}

function groupProducts(catalog: Item[]): Product[] {
  const map = new Map<string, Product>();
  for (const item of catalog) {
    const key = item.name.toLowerCase();
    const p = map.get(key) ?? { key, name: item.name, variants: [] };
    p.variants.push(item);
    map.set(key, p);
  }
  return [...map.values()];
}

function scoreProduct(spoken: string, p: Product): number {
  const names = [p.name, ...p.variants.flatMap((v) => v.aliases)];
  const ps = phonetic(spoken);
  let best = 0;
  for (const n of names) {
    best = Math.max(best, similarity(spoken, n));
    const pn = phonetic(n);
    // "dal" vs "toor dal", "tel" vs "sarson tel": a clear substring is a decent match.
    if (ps.length >= 3 && pn.length >= 3 && (pn.includes(ps) || ps.includes(pn))) best = Math.max(best, 0.8);
  }
  return best;
}

const option = (item: Item, quantity: number | null): BillIssueOption => ({
  itemId: item.id,
  label: itemDisplayName(item),
  quantity: quantity ?? undefined,
  unitPrice: item.price,
  amount: item.price !== null && quantity !== null ? lineAmount(item.price, quantity) : null,
});

const newIssue = (fields: Omit<BillIssue, 'id'>): BillIssue => ({ id: crypto.randomUUID(), ...fields });

function variantOptions(products: Product[], line: ParsedLine) {
  return products.flatMap((p) => p.variants.map((v) => option(v, quantityFor(v, line.count, line.measure) ?? line.count ?? 1)));
}

/** Matches one spoken line against the store's catalogue. */
export function resolveLine(catalog: Item[], line: ParsedLine): ResolvedLine {
  const products = groupProducts(catalog);

  if (line.unclear) {
    // Only the first sound is reliable ("m…l"): offer products starting with it, best guesses first.
    const first = phonetic(line.name)[0];
    const guesses = products
      .filter((p) => first && phonetic(p.name).startsWith(first))
      .map((p) => ({ p, s: scoreProduct(line.name.replace(/\s+/g, ''), p) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.p);
    return {
      kind: 'issue',
      issue: newIssue({ kind: 'unclear', raw: line.raw, name: line.name, quantity: line.count ?? undefined, options: variantOptions(guesses, line) }),
    };
  }

  const scored = products
    .map((p) => ({ p, s: scoreProduct(line.name, p) }))
    .filter((x) => x.s >= MATCH_THRESHOLD)
    .sort((a, b) => b.s - a.s);

  if (!scored.length) {
    const suggestions = products
      .map((p) => ({ p, s: scoreProduct(line.name, p) }))
      .filter((x) => x.s >= 0.45)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.p);
    return {
      kind: 'issue',
      issue: newIssue({ kind: 'not_found', raw: line.raw, name: line.name, quantity: line.count ?? undefined, options: variantOptions(suggestions, line) }),
    };
  }

  const close = scored.filter((x) => x.s >= scored[0].s - AMBIGUITY_MARGIN);
  if (close.length > 1) {
    return {
      kind: 'issue',
      issue: newIssue({ kind: 'unclear', raw: line.raw, name: line.name, quantity: line.count ?? undefined, options: variantOptions(close.map((x) => x.p), line) }),
    };
  }

  const product = scored[0].p;
  const fits = product.variants
    .map((v) => ({ v, q: quantityFor(v, line.count, line.measure) }))
    .filter((x): x is { v: Item; q: number } => x.q !== null);

  let chosen: { v: Item; q: number } | undefined;
  if (product.variants.length === 1 && fits.length === 1) chosen = fits[0];
  else if (line.measure && fits.length === 1) chosen = fits[0];
  else if (line.measure && fits.length > 1) {
    // Prefer the pack that matches exactly, then the fewest packs.
    chosen = [...fits].sort((a, b) => a.q - b.q)[0];
  }

  if (!chosen) {
    return {
      kind: 'issue',
      issue: newIssue({
        kind: 'choose_variant',
        raw: line.raw,
        name: product.name,
        quantity: line.count ?? 1,
        options: product.variants.map((v) => option(v, line.count ?? 1)),
      }),
    };
  }

  if (chosen.v.price === null) {
    return {
      kind: 'issue',
      issue: newIssue({
        kind: 'price_missing',
        raw: line.raw,
        name: itemDisplayName(chosen.v),
        itemId: chosen.v.id,
        quantity: chosen.q,
        options: [],
      }),
    };
  }
  return { kind: 'ok', item: chosen.v, quantity: chosen.q };
}
