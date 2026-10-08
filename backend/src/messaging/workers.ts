import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { outboundMessages, stores, users } from '../db/schema.js';
import { purgeOldVoiceEvents } from '../modules/learning/learning.service.js';
import { dailySummary, localDate, summaryMessage } from '../modules/summary/summary.service.js';
import type { MessageSender } from './sender.js';

const MAX_ATTEMPTS = 5;

const CLAIM_SECONDS = 120;

/**
 * Sends queued messages. Messages are first claimed in one short statement (SKIP LOCKED, so several
 * API instances can run this in parallel), then sent with no transaction open, so a slow provider
 * never holds database locks. A claim expires after CLAIM_SECONDS, so messages claimed by a sender
 * that crashed are retried. Failures back off exponentially and are marked failed after
 * MAX_ATTEMPTS. Delivery is at-least-once: a crash between sending and recording can repeat one.
 */
export async function deliverPendingMessages(db: Db, sender: MessageSender, log: FastifyBaseLogger, batch = 20) {
  const claimed = (
    await db.execute(sql`
      update ${outboundMessages} set locked_until = now() + make_interval(secs => ${CLAIM_SECONDS})
      where id in (
        select id from ${outboundMessages}
        where status = 'pending' and send_after <= now() and (locked_until is null or locked_until < now())
        order by created_at
        limit ${batch}
        for update skip locked
      )
      returning id, to_phone, body, type, attempts`)
  ).rows as { id: string; to_phone: string; body: string; type: 'receipt' | 'reminder' | 'daily_summary'; attempts: number }[];

  for (const m of claimed) {
    try {
      await sender.send({ to: m.to_phone, body: m.body, kind: m.type });
      await db
        .update(outboundMessages)
        .set({ status: 'sent', sentAt: new Date(), attempts: m.attempts + 1, lockedUntil: null })
        .where(eq(outboundMessages.id, m.id));
    } catch (err) {
      const attempts = m.attempts + 1;
      log.warn({ err, messageId: m.id, attempts }, 'message delivery failed');
      await db
        .update(outboundMessages)
        .set({
          attempts,
          lockedUntil: null,
          lastError: String((err as Error).message ?? err).slice(0, 500),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          sendAfter: sql`now() + make_interval(mins => ${2 ** attempts})`,
        })
        .where(eq(outboundMessages.id, m.id));
    }
  }
  return claimed.length;
}

/**
 * Queues the nightly "roz ka hisaab" for each onboarded store whose local summary time has passed.
 * Claiming via a conditional update makes it run once per store per day even with many instances.
 */
export async function queueDailySummaries(db: Db, now = new Date()) {
  // Only shops whose local summary time has passed and that haven't had today's summary.
  const at = now.toISOString();
  const candidates = await db
    .select({ store: stores, ownerPhone: users.phone })
    .from(stores)
    .innerJoin(users, eq(users.id, stores.ownerId))
    .where(
      and(
        isNotNull(stores.onboardedAt),
        sql`to_char(${at}::timestamptz at time zone ${stores.timezone}, 'HH24:MI') >= ${stores.summaryTime}`,
        sql`${stores.lastSummaryDate} is distinct from (${at}::timestamptz at time zone ${stores.timezone})::date`,
      ),
    );

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
  let running: Promise<unknown> | null = null;
  let stopped = false;
  const tick = async (fn: () => Promise<unknown>, name: string) => {
    if (running || stopped) return;
    running = fn().catch((err) => log.error({ err }, `${name} failed`));
    try {
      await running;
    } finally {
      running = null;
    }
  };
  const outbox = setInterval(() => void tick(() => deliverPendingMessages(db, sender, log), 'outbox'), 5_000);
  const summaries = setInterval(() => void tick(() => queueDailySummaries(db), 'daily summary'), 60_000);
  // Voice logs are kept for a limited time only.
  const purge = setInterval(() => void tick(() => purgeOldVoiceEvents(db), 'voice log purge'), 60 * 60_000);
  /** Stops the timers and waits for a job that is already running, so shutdown never cuts one off. */
  return async () => {
    stopped = true;
    clearInterval(outbox);
    clearInterval(summaries);
    clearInterval(purge);
    await running;
  };
}
