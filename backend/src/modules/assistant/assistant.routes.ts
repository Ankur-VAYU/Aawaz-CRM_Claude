import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { customers, items, ledgerEntries, type Customer, type Store } from '../../db/schema.js';
import { reply } from '../../lib/replies.js';
import { itemDisplayName } from '../../lib/serialize.js';
import { validate } from '../../lib/validate.js';
import type { BillsService } from '../bills/bills.service.js';
import { presentCustomer } from '../customers/customers.routes.js';
import { recordPayment, resolveCustomer, sendReminder } from '../customers/customers.service.js';
import { previewStockIn } from '../items/stock-in.service.js';
import { dailySummary } from '../summary/summary.service.js';
import { parseCommand } from './parser.js';

const messageBody = z.object({
  /** What the shopkeeper said (transcribed on the phone) or typed. */
  text: z.string().trim().min(1).max(2000),
  source: z.enum(['voice', 'text']).default('voice'),
  /** Idempotency key so a retried message doesn't create a second bill. */
  clientId: z.string().trim().min(8).max(64).optional(),
});

interface Options {
  db: Db;
  billsService: BillsService;
  publicBaseUrl: string;
}

export default async function assistantRoutes(app: FastifyInstance, { db, billsService, publicBaseUrl }: Options) {
  app.addHook('onRequest', app.requireStore);

  app.post('/message', async (req) => {
    const body = validate(messageBody, req.body);
    const store = req.store;
    const lang = store.language;
    const speak = store.replyStyle === 'voice_text';
    const intent = parseCommand(body.text);
    const answer = (text: string, data: Record<string, unknown> = {}) => ({
      intent: intent.type,
      reply: { text, speak },
      ...data,
    });

    /** Shared handling when a command names a customer. */
    const withCustomer = async (name: string, then: (c: Customer) => Promise<ReturnType<typeof answer>>) => {
      const match = await resolveCustomer(db, store.id, name);
      if (match.status === 'found') return then(match.customer);
      if (match.status === 'ambiguous') {
        return answer(reply(lang, 'customerAmbiguous', { name }), {
          needsInput: { kind: 'customer_ambiguous', options: match.candidates.map(presentCustomer) },
        });
      }
      return answer(reply(lang, 'customerNotFound', { name }), { needsInput: { kind: 'customer_unknown', name } });
    };

    switch (intent.type) {
      case 'create_bill': {
        const bill = await billsService.createDraftFromSpeech(store, intent, {
          transcript: body.text,
          source: body.source,
          clientId: body.clientId,
        });
        const text = bill.issues.length
          ? reply(lang, 'billNeedsInput', { n: bill.issues.length })
          : reply(lang, 'billDraft', { customer: bill.customer?.name ?? null, count: bill.itemCount, total: bill.total });
        return answer(text, { bill });
      }

      case 'query_balance':
        return withCustomer(intent.customerName, async (c) => {
          const recent = await db
            .select()
            .from(ledgerEntries)
            .where(eq(ledgerEntries.customerId, c.id))
            .orderBy(desc(ledgerEntries.createdAt))
            .limit(5);
          return answer(reply(lang, 'balance', { name: c.name, balance: c.balance }), {
            customer: presentCustomer(c),
            recentEntries: recent,
          });
        });

      case 'record_payment':
        return withCustomer(intent.customerName, async (c) => {
          const result = await recordPayment(db, {
            storeId: store.id,
            customerId: c.id,
            amount: intent.amount,
            method: intent.method,
            clientId: body.clientId,
          });
          return answer(
            reply(lang, 'paymentRecorded', { name: c.name, amount: intent.amount, balance: result.customer.balance }),
            { customer: presentCustomer(result.customer), entry: result.entry },
          );
        });

      case 'send_reminder':
        return withCustomer(intent.customerName, async (c) => {
          await sendReminder(db, store, c, publicBaseUrl);
          return answer(reply(lang, 'reminderQueued', { name: c.name }), { customer: presentCustomer(c) });
        });

      case 'list_customers': {
        const [totals] = await db
          .select({
            total: sql<number>`count(*)::int`,
            dues: sql<string>`coalesce(sum(${customers.balance}) filter (where ${customers.balance} > 0), 0)`,
          })
          .from(customers)
          .where(and(eq(customers.storeId, store.id), isNull(customers.anonymizedAt)));
        const top = await db
          .select()
          .from(customers)
          .where(and(eq(customers.storeId, store.id), isNull(customers.anonymizedAt)))
          .orderBy(desc(customers.balance), sql`${customers.lastPurchaseAt} desc nulls last`)
          .limit(5);
        return answer(reply(lang, 'customers', { total: totals.total, dues: Number(totals.dues) }), {
          customers: top.map(presentCustomer),
          total: totals.total,
          totalDues: Number(totals.dues),
        });
      }

      case 'daily_summary': {
        const summary = await dailySummary(db, store);
        return answer(reply(lang, 'summary', { sales: summary.sales.total, bills: summary.sales.bills }), { summary });
      }

      case 'stock_in': {
        const catalog = await db.select().from(items).where(and(eq(items.storeId, store.id), eq(items.isActive, true)));
        const preview = previewStockIn(catalog, intent.lines);
        const text = reply(lang, 'stockInPreview', { matched: preview.matched.length, unmatched: preview.unmatched.length });
        // Nothing changes until the app sends POST /items/receive.
        return answer(text, { stockIn: { supplier: intent.supplier, ...preview } });
      }

      case 'low_stock': {
        const low = await lowStockItems(db, store);
        return answer(reply(lang, 'lowStock', { n: low.length }), { items: low });
      }

      default:
        return answer(reply(lang, 'notUnderstood'));
    }
  });
}

async function lowStockItems(db: Db, store: Store) {
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.storeId, store.id), eq(items.isActive, true), lte(items.stock, items.lowStockThreshold)));
  return rows.map((i) => ({ ...i, displayName: itemDisplayName(i) }));
}
