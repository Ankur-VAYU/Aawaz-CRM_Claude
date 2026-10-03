import { and, count, desc, eq, gt, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { customers, ledgerEntries, type Customer } from '../../db/schema.js';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors.js';
import { reply as say } from '../../lib/replies.js';
import { generateShareToken } from '../../lib/tokens.js';
import { validate } from '../../lib/validate.js';
import { phone } from '../auth/auth.schemas.js';
import { canMessage, recordPayment, reversePayment, sendReminder, shareLink } from './customers.service.js';
import { isValidGstin } from '../../lib/gst.js';

/** Customers who haven't bought anything for this many days show under "Kaafi din se nahi aaye". */
export const INACTIVE_DAYS = 14;

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  filter: z.enum(['all', 'dues', 'inactive']).default('all'),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const gstin = z.string().trim().toUpperCase().refine(isValidGstin, 'Invalid GSTIN');
const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phone.optional(),
  gstin: gstin.optional(),
  /** The shopkeeper confirms the customer agreed to get WhatsApp messages (receipts, reminders). */
  messagingConsent: z.boolean().default(false),
});
const updateBody = z
  .object({ name: z.string().trim().min(1).max(120), phone: phone.nullable(), gstin: gstin.nullable(), messagingConsent: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');
const paymentBody = z.object({
  amount: z.number().positive().max(10_000_000), // rupees
  method: z.enum(['cash', 'upi']).default('cash'),
  note: z.string().trim().max(200).optional(),
  clientId: z.string().trim().min(8).max(64).optional(),
});
const reverseParams = z.object({ id: z.uuid(), entryId: z.uuid() });
const reverseBody = z.object({ note: z.string().trim().max(200).optional() }).default({});
const ledgerQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const presentCustomer = (c: Customer) => ({
  id: c.id,
  name: c.name,
  initials: initials(c.name),
  phone: c.phone,
  gstin: c.gstin,
  balance: c.balance,
  totalPurchases: c.totalPurchases,
  totalPaid: c.totalPaid,
  lastPurchaseAt: c.lastPurchaseAt,
  messagingConsent: c.messagingConsentAt !== null,
  messagesOptedOut: c.messagesOptedOutAt !== null,
  canMessage: canMessage(c),
  deletionRequestedAt: c.deletionRequestedAt,
  createdAt: c.createdAt,
});

export default async function customerRoutes(
  app: FastifyInstance,
  { db, publicBaseUrl }: { db: Db; publicBaseUrl: string },
) {
  app.addHook('onRequest', app.requireStore);

  const inactiveCutoff = sql`now() - make_interval(days => ${INACTIVE_DAYS})`;
  const isInactive = or(
    lt(customers.lastPurchaseAt, inactiveCutoff),
    and(isNull(customers.lastPurchaseAt), lt(customers.createdAt, inactiveCutoff)),
  )!;

  app.get('/', async (req) => {
    const q = validate(listQuery, req.query);
    const base: SQL[] = [eq(customers.storeId, req.store.id), isNull(customers.anonymizedAt)];
    const filters = [...base];
    if (q.filter === 'dues') filters.push(gt(customers.balance, 0));
    if (q.filter === 'inactive') filters.push(isInactive);
    if (q.search) {
      const p = `%${escapeLike(q.search)}%`;
      filters.push(or(ilike(customers.name, p), ilike(customers.phone, p))!);
    }
    const where = and(...filters);

    const [rows, [{ total }], [counts]] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(where)
        // Biggest dues first, like the design; then most recent buyers.
        .orderBy(desc(customers.balance), sql`${customers.lastPurchaseAt} desc nulls last`, desc(customers.id))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit),
      db.select({ total: count() }).from(customers).where(where),
      db
        .select({
          all: count(),
          dues: sql<number>`count(*) filter (where ${customers.balance} > 0)::int`,
          inactive: sql<number>`count(*) filter (where ${isInactive})::int`,
          totalDues: sql<number>`coalesce(sum(${customers.balance}) filter (where ${customers.balance} > 0), 0)::bigint`,
        })
        .from(customers)
        .where(and(...base)),
    ]);

    return {
      data: rows.map((c) => ({ ...presentCustomer(c), inactive: isInactiveCustomer(c) })),
      counts: { all: counts.all, dues: counts.dues, inactive: counts.inactive },
      totalDues: Number(counts.totalDues),
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  });

  app.post('/', async (req, reply) => {
    const { messagingConsent, ...body } = validate(createBody, req.body);
    try {
      const [c] = await db
        .insert(customers)
        .values({
          ...body,
          storeId: req.store.id,
          shareToken: generateShareToken(),
          ...(messagingConsent ? { messagingConsentAt: new Date(), messagingConsentSource: 'shopkeeper' } : {}),
        })
        .returning();
      return reply.code(201).send({ customer: presentCustomer(c) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A customer with this phone number already exists');
      throw err;
    }
  });

  async function load(storeId: string, id: string) {
    const [c] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.storeId, storeId), isNull(customers.anonymizedAt)));
    if (!c) throw notFound('Customer not found');
    return c;
  }

  app.get('/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    const c = await load(req.store.id, id);
    const [{ entries }] = await db
      .select({ entries: count() })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.customerId, c.id));
    return {
      customer: presentCustomer(c),
      khata: { since: c.createdAt, entries, balance: c.balance },
      shareLink: shareLink(publicBaseUrl, c),
    };
  });

  app.patch('/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    const { messagingConsent, ...body } = validate(updateBody, req.body);
    const existing = await load(req.store.id, id);
    const consent =
      messagingConsent === undefined
        ? {}
        : messagingConsent
          ? existing.messagingConsentAt
            ? {}
            : { messagingConsentAt: new Date(), messagingConsentSource: 'shopkeeper' }
          : { messagingConsentAt: null, messagingConsentSource: null };
    try {
      const [c] = await db.update(customers).set({ ...body, ...consent }).where(eq(customers.id, id)).returning();
      return { customer: presentCustomer(c) };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A customer with this phone number already exists');
      throw err;
    }
  });

  // Khata history ("Pichhla hisaab"), newest first.
  app.get('/:id/ledger', async (req) => {
    const { id } = validate(idParams, req.params);
    const q = validate(ledgerQuery, req.query);
    const c = await load(req.store.id, id);
    const [rows, [{ total }]] = await Promise.all([
      db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.customerId, c.id),
        orderBy: [desc(ledgerEntries.createdAt), desc(ledgerEntries.id)],
        limit: q.limit,
        offset: (q.page - 1) * q.limit,
        with: { bill: { columns: { billNumber: true, invoiceNumber: true, total: true }, with: { items: { columns: { id: true } } } } },
      }),
      db.select({ total: count() }).from(ledgerEntries).where(eq(ledgerEntries.customerId, c.id)),
    ]);
    return {
      customer: presentCustomer(c),
      data: rows.map(({ bill, ...e }) => ({
        ...e,
        billNumber: bill?.billNumber ?? null,
        invoiceNumber: bill?.invoiceNumber ?? null,
        itemCount: bill?.items.length ?? null,
      })),
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  });

  // "Paisa mila"
  app.post('/:id/payments', async (req, reply) => {
    const { id } = validate(idParams, req.params);
    const body = validate(paymentBody, req.body);
    const c = await load(req.store.id, id);
    const amount = Math.round(body.amount * 100);
    const result = await recordPayment(db, {
      storeId: req.store.id,
      customerId: c.id,
      amount,
      method: body.method,
      note: body.note,
      clientId: body.clientId,
    });
    return reply.code(result.duplicate ? 200 : 201).send({
      entry: result.entry,
      customer: presentCustomer(result.customer),
      duplicate: result.duplicate,
      reply: say(req.store.language, 'paymentRecorded', { name: c.name, amount, balance: result.customer.balance }),
    });
  });

  // Undo a payment entered by mistake.
  app.post('/:id/ledger/:entryId/reverse', async (req, reply) => {
    const { id, entryId } = validate(reverseParams, req.params);
    const { note } = validate(reverseBody, req.body ?? {});
    await load(req.store.id, id);
    const result = await reversePayment(db, req.store.id, id, entryId, note);
    return reply.code(201).send({ entry: result.entry, customer: presentCustomer(result.customer) });
  });

  // "Yaad dilao": WhatsApp reminder of the outstanding balance. At most one per customer per day.
  app.post('/:id/reminders', async (req, reply) => {
    const { id } = validate(idParams, req.params);
    const c = await load(req.store.id, id);
    await sendReminder(db, req.store, c, publicBaseUrl);
    return reply.code(202).send({ queued: true, reply: say(req.store.language, 'reminderQueued', { name: c.name }) });
  });
}

export function isInactiveCustomer(c: Pick<Customer, 'lastPurchaseAt' | 'createdAt'>) {
  const cutoff = Date.now() - INACTIVE_DAYS * 24 * 3600 * 1000;
  return (c.lastPurchaseAt ?? c.createdAt).getTime() < cutoff;
}
