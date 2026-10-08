import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { customers, items, voiceEvents, type Store } from '../../db/schema.js';
import { itemDisplayName } from '../../lib/serialize.js';
import { normalizeText } from '../../lib/text.js';

const MAX_ALIASES = 10;
export const VOICE_LOG_RETENTION_DAYS = 90;

/**
 * Turns words as heard into an alias worth remembering, or null. Fragments from unclear speech
 * ("m l"), numbers and very short words are not learned.
 */
export function aliasFrom(spoken: string | undefined | null): string | null {
  if (!spoken) return null;
  const a = normalizeText(spoken);
  if (/\d/.test(a)) return null;
  if (a.replace(/[^\p{L}]/gu, '').length < 3) return null;
  if (a.split(' ').some((w) => w.length === 1)) return null;
  return a;
}

const withAlias = (current: string[], name: string, alias: string) => {
  const known = [name, ...current].map((x) => normalizeText(x));
  if (known.includes(alias)) return null;
  return [...current, alias].slice(-MAX_ALIASES);
};

/** The shopkeeper picked `itemId` for what was heard as `spoken`: remember it for next time. */
export async function learnItemAlias(db: Db, storeId: string, itemId: string, spoken: string | undefined | null) {
  const alias = aliasFrom(spoken);
  if (!alias) return null;
  const [item] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.storeId, storeId)));
  if (!item) return null;
  const next = withAlias(item.aliases, item.name, alias);
  if (!next) return null;
  await db.update(items).set({ aliases: next }).where(eq(items.id, itemId));
  return { type: 'item' as const, heard: alias, name: itemDisplayName(item) };
}

/** The shopkeeper said who "Raam" is: remember the spoken name for that customer. */
export async function learnCustomerAlias(db: Db, storeId: string, customerId: string, spoken: string | undefined | null) {
  const alias = aliasFrom(spoken);
  if (!alias) return null;
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)));
  if (!c) return null;
  const next = withAlias(c.aliases, c.name, alias);
  if (!next) return null;
  await db.update(customers).set({ aliases: next }).where(eq(customers.id, customerId));
  return { type: 'customer' as const, heard: alias, name: c.name };
}

export type Learned = Awaited<ReturnType<typeof learnItemAlias>> | Awaited<ReturnType<typeof learnCustomerAlias>>;

/** Records a misunderstood command or a correction, only for shops that opted in. */
export async function logVoiceEvent(
  db: Db,
  store: Pick<Store, 'id' | 'voiceLogOptIn' | 'language'>,
  e: { text: string; source?: string; intent?: string; outcome: 'not_understood' | 'needs_input' | 'corrected'; details?: Record<string, unknown> },
) {
  if (!store.voiceLogOptIn) return;
  await db.insert(voiceEvents).values({
    storeId: store.id,
    text: e.text.slice(0, 2000),
    source: e.source ?? null,
    language: store.language,
    intent: e.intent ?? null,
    outcome: e.outcome,
    details: e.details ?? {},
  });
}

export async function listVoiceEvents(db: Db, storeId: string, limit: number) {
  return db.select().from(voiceEvents).where(eq(voiceEvents.storeId, storeId)).orderBy(desc(voiceEvents.createdAt)).limit(limit);
}

/** Everything the shop's voice understanding has learned (and can be removed again). */
export async function learnedNames(db: Db, storeId: string) {
  const [itemRows, customerRows] = await Promise.all([
    db.select().from(items).where(and(eq(items.storeId, storeId), sql`cardinality(${items.aliases}) > 0`)),
    db.select().from(customers).where(and(eq(customers.storeId, storeId), sql`cardinality(${customers.aliases}) > 0`)),
  ]);
  return {
    items: itemRows.map((i) => ({ id: i.id, name: itemDisplayName(i), aliases: i.aliases })),
    customers: customerRows.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })),
  };
}

export async function forgetAlias(db: Db, storeId: string, kind: 'item' | 'customer', id: string, alias: string) {
  const a = normalizeText(alias);
  if (kind === 'item') {
    const r = await db
      .update(items)
      .set({ aliases: sql`array_remove(${items.aliases}, ${a})` })
      .where(and(eq(items.id, id), eq(items.storeId, storeId)))
      .returning({ id: items.id });
    return r.length > 0;
  }
  const r = await db
    .update(customers)
    .set({ aliases: sql`array_remove(${customers.aliases}, ${a})` })
    .where(and(eq(customers.id, id), eq(customers.storeId, storeId)))
    .returning({ id: customers.id });
  return r.length > 0;
}

/** Deletes voice events older than the retention period (all shops). */
export async function purgeOldVoiceEvents(db: Db, days = VOICE_LOG_RETENTION_DAYS) {
  const r = await db
    .delete(voiceEvents)
    .where(sql`${voiceEvents.createdAt} < now() - make_interval(days => ${days})`)
    .returning({ id: voiceEvents.id });
  return r.length;
}
