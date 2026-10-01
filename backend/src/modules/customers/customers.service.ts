import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { customers, ledgerEntries, outboundMessages, type Customer, type Store } from '../../db/schema.js';
import { AppError, badRequest, conflict, isUniqueViolation } from '../../lib/errors.js';
import { reminderMessage } from '../../lib/replies.js';
import { similarity } from '../../lib/text.js';

/** Finds customers whose name (or first name) sounds like what was said. Best matches first. */
export async function findCustomersByName(db: Db, storeId: string, spoken: string, limit = 5) {
  const all = await db
    .select()
    .from(customers)
    .where(and(eq(customers.storeId, storeId), isNull(customers.anonymizedAt)));
  return all
    .map((c) => {
      const first = c.name.split(' ')[0];
      return { customer: c, score: Math.max(similarity(spoken, c.name), similarity(spoken, first)) };
    })
    .filter((m) => m.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Exact or single clearly-best match, or the candidates when it's ambiguous. */
export async function resolveCustomer(db: Db, storeId: string, spoken: string) {
  const matches = await findCustomersByName(db, storeId, spoken);
  if (!matches.length) return { status: 'not_found' as const, candidates: [] };
  const exact = matches.filter((m) => m.score === 1);
  if (exact.length === 1) return { status: 'found' as const, customer: exact[0].customer };
  if (matches.length === 1) return { status: 'found' as const, customer: matches[0].customer };
  return { status: 'ambiguous' as const, candidates: matches.map((m) => m.customer) };
}

/**
 * Applies a change to a customer's khata inside a transaction: locks the row, updates the running
 * balance and appends a ledger entry. `amount` is signed paise (+ owes more, − paid).
 */
export async function postLedgerEntry(
  tx: Db,
  entry: {
    storeId: string;
    customerId: string;
    type: 'bill' | 'payment' | 'bill_cancelled';
    amount: number;
    billId?: string;
    method?: 'cash' | 'upi';
    note?: string;
    clientId?: string;
  },
) {
  const [before] = await tx
    .select({ balance: customers.balance })
    .from(customers)
    .where(eq(customers.id, entry.customerId))
    .for('update');
  const [after] = await tx
    .update(customers)
    .set({
      balance: sql`${customers.balance} + ${entry.amount}`,
      ...(entry.type === 'payment' ? { totalPaid: sql`${customers.totalPaid} + ${-entry.amount}` } : {}),
    })
    .where(eq(customers.id, entry.customerId))
    .returning();
  const [row] = await tx
    .insert(ledgerEntries)
    .values({ ...entry, balanceAfter: after.balance })
    .returning();
  return { entry: row, balanceBefore: before.balance, customer: after };
}

export function shareLink(baseUrl: string, customer: Pick<Customer, 'shareToken'>) {
  return `${baseUrl.replace(/\/$/, '')}/c/${customer.shareToken}`;
}

/** Queues a WhatsApp message to a customer, unless they've opted out or have no number. */
export async function enqueueCustomerMessage(
  tx: Db,
  store: Store,
  customer: Customer,
  type: 'receipt' | 'reminder',
  body: string,
  payload: Record<string, unknown> = {},
) {
  if (!customer.phone || customer.messagesOptedOutAt || customer.anonymizedAt) return false;
  await tx.insert(outboundMessages).values({
    storeId: store.id,
    customerId: customer.id,
    toPhone: customer.phone,
    type,
    body,
    payload,
  });
  return true;
}

/** "Yaad dilao": WhatsApp reminder of the outstanding balance. At most one per customer per day. */
export async function sendReminder(db: Db, store: Store, c: Customer, publicBaseUrl: string) {
  if (c.balance <= 0) throw badRequest('Nothing is due from this customer');
  if (!c.phone) throw badRequest('Add the customer’s phone number to send reminders');
  if (c.messagesOptedOutAt) throw conflict('This customer has turned off messages', 'OPTED_OUT');
  const [recent] = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.customerId, c.id),
        eq(outboundMessages.type, 'reminder'),
        gt(outboundMessages.createdAt, sql`now() - interval '24 hours'`),
      ),
    )
    .limit(1);
  if (recent) throw new AppError(409, 'REMINDER_TOO_SOON', 'A reminder was already sent in the last 24 hours');
  await enqueueCustomerMessage(
    db,
    store,
    c,
    'reminder',
    reminderMessage({ storeName: store.name, customerName: c.name, balance: c.balance, link: shareLink(publicBaseUrl, c) }),
  );
}

/**
 * Records a payment ("Paisa mila"). With a clientId, retries return the original entry instead of
 * taking the money off twice.
 */
export async function recordPayment(
  db: Db,
  p: { storeId: string; customerId: string; amount: number; method: 'cash' | 'upi'; note?: string; clientId?: string },
) {
  const existing = async () => {
    if (!p.clientId) return null;
    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.storeId, p.storeId), eq(ledgerEntries.clientId, p.clientId)));
    if (!entry) return null;
    const [customer] = await db.select().from(customers).where(eq(customers.id, entry.customerId));
    return { entry, customer, duplicate: true };
  };
  const prior = await existing();
  if (prior) return prior;
  try {
    const result = await db.transaction((tx) =>
      postLedgerEntry(tx as unknown as Db, {
        storeId: p.storeId,
        customerId: p.customerId,
        type: 'payment',
        amount: -p.amount,
        method: p.method,
        note: p.note,
        clientId: p.clientId,
      }),
    );
    return { entry: result.entry, customer: result.customer, duplicate: false };
  } catch (err) {
    const raced = isUniqueViolation(err) ? await existing() : null;
    if (raced) return raced;
    throw err;
  }
}
