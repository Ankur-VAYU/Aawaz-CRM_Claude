import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { outboundMessages, stores, users } from '../db/schema.js';
import { dailySummary, localDate, summaryMessage } from '../modules/summary/summary.service.js';
import type { MessageSender } from './sender.js';

const MAX_ATTEMPTS = 5;

/**
 * Sends queued messages. Uses SKIP LOCKED so several API instances can run this safely in parallel.
 * Failed sends are retried with exponential backoff, then marked failed.
 */
export async function deliverPendingMessages(db: Db, sender: MessageSender, log: FastifyBaseLogger, batch = 20) {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const due = await tx
      .select()
      .from(outboundMessages)
      .where(and(eq(outboundMessages.status, 'pending'), sql`${outboundMessages.sendAfter} <= now()`))
      .orderBy(outboundMessages.createdAt)
      .limit(batch)
      .for('update', { skipLocked: true });

    for (const m of due) {
      try {
        await sender.send({ to: m.toPhone, body: m.body, kind: m.type });
        await tx.update(outboundMessages).set({ status: 'sent', sentAt: new Date(), attempts: m.attempts + 1 }).where(eq(outboundMessages.id, m.id));
      } catch (err) {
        const attempts = m.attempts + 1;
        log.warn({ err, messageId: m.id, attempts }, 'message delivery failed');
        await tx
          .update(outboundMessages)
          .set({
            attempts,
            lastError: String((err as Error).message ?? err).slice(0, 500),
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            sendAfter: sql`now() + make_interval(mins => ${2 ** attempts})`,
          })
          .where(eq(outboundMessages.id, m.id));
      }
    }
    return due.length;
  });
}

/**
 * Queues the nightly "roz ka hisaab" for each onboarded store whose local summary time has passed.
 * Claiming via a conditional update makes it run once per store per day even with many instances.
 */
export async function queueDailySummaries(db: Db, now = new Date()) {
  const candidates = await db
    .select({ store: stores, ownerPhone: users.phone })
    .from(stores)
    .innerJoin(users, eq(users.id, stores.ownerId))
    .where(isNotNull(stores.onboardedAt));

  let queued = 0;
  for (const { store, ownerPhone } of candidates) {
    const today = localDate(store.timezone, now);
    if (store.lastSummaryDate === today) continue;
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: store.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    if (hhmm < store.summaryTime) continue;

    const claimed = await db
      .update(stores)
      .set({ lastSummaryDate: today })
      .where(and(eq(stores.id, store.id), sql`${stores.lastSummaryDate} is distinct from ${today}`))
      .returning({ id: stores.id });
    if (!claimed.length) continue;

    const summary = await dailySummary(db, store, today);
    await db.insert(outboundMessages).values({
      storeId: store.id,
      toPhone: ownerPhone,
      type: 'daily_summary',
      body: summaryMessage(store.name, summary, store.language),
      payload: summary,
    });
    queued++;
  }
  return queued;
}

export function startWorkers(db: Db, sender: MessageSender, log: FastifyBaseLogger) {
  let busy = false;
  const tick = async (fn: () => Promise<unknown>, name: string) => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      log.error({ err }, `${name} failed`);
    } finally {
      busy = false;
    }
  };
  const outbox = setInterval(() => void tick(() => deliverPendingMessages(db, sender, log), 'outbox'), 5_000);
  const summaries = setInterval(() => void tick(() => queueDailySummaries(db), 'daily summary'), 60_000);
  return () => {
    clearInterval(outbox);
    clearInterval(summaries);
  };
}
