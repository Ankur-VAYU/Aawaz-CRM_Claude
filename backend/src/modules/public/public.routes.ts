import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { billItems, bills, customers, ledgerEntries, stores, type Customer } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { formatRupees } from '../../lib/money.js';
import { maskPhone } from '../../lib/phone.js';
import { generateShareToken } from '../../lib/tokens.js';
import { validate } from '../../lib/validate.js';

/*
 * Customer-facing, read-only views reached from links in WhatsApp messages. Access is by
 * unguessable token only; nothing here exposes other customers or the shop's data.
 */

const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

async function customerByToken(db: Db, token: string) {
  const [row] = await db
    .select({ customer: customers, storeName: stores.name })
    .from(customers)
    .innerJoin(stores, eq(stores.id, customers.storeId))
    .where(and(eq(customers.shareToken, token), isNull(customers.anonymizedAt)));
  if (!row) throw notFound('Link not found or expired');
  return row;
}

async function khataView(db: Db, token: string) {
  const { customer: c, storeName } = await customerByToken(db, token);
  const entries = await db.query.ledgerEntries.findMany({
    where: eq(ledgerEntries.customerId, c.id),
    orderBy: [desc(ledgerEntries.createdAt)],
    limit: 20,
    with: { bill: { columns: { billNumber: true }, with: { items: { columns: { id: true } } } } },
  });
  return {
    store: { name: storeName },
    customer: { name: c.name, phone: c.phone ? maskPhone(c.phone) : null, since: c.createdAt },
    balance: c.balance,
    totalPurchases: c.totalPurchases,
    totalPaid: c.totalPaid,
    asOf: new Date(),
    messagesOptedOut: c.messagesOptedOutAt !== null,
    entries: entries.map((e) => ({
      date: e.createdAt,
      type: e.type,
      amount: e.amount,
      method: e.method,
      billNumber: e.bill?.billNumber ?? null,
      itemCount: e.bill?.items.length ?? null,
    })),
  };
}

async function receiptView(db: Db, token: string) {
  const bill = await db.query.bills.findFirst({
    where: and(eq(bills.receiptToken, token), eq(bills.status, 'confirmed')),
    with: { items: { orderBy: [asc(billItems.position)] }, customer: true },
  });
  if (!bill) throw notFound('Receipt not found');
  const [store] = await db.select().from(stores).where(eq(stores.id, bill.storeId));
  return {
    store: { name: store.name, city: store.city, gstin: store.gstin },
    billNumber: bill.billNumber,
    date: bill.confirmedAt,
    customer: bill.customer && !bill.customer.anonymizedAt ? { name: bill.customer.name } : null,
    lines: bill.items.map((l) => ({ name: l.name, sizeLabel: l.sizeLabel, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })),
    total: bill.total,
    paymentMode: bill.paymentMode,
    balance: bill.paymentMode === 'udhaar' && bill.customer ? bill.customer.balance : null,
  };
}

/* ---------- Minimal HTML pages for the WhatsApp links ---------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';

function page(title: string, body: string) {
  return `<!doctype html><html lang="hi-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<style>
body{margin:0;background:#EFE7DD;color:#233D44;font-family:'Noto Sans','Noto Sans Devanagari',system-ui,sans-serif}
header{background:#0B6E5F;color:#F7F5F2;padding:16px;font-weight:700;font-size:18px}
main{max-width:420px;margin:16px auto;padding:0 16px}
.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(11,20,26,.13)}
.row{display:flex;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid #EFE7DD;font-size:15px}
.due{margin:12px 16px;padding:14px 16px;border-radius:14px;background:#FCEFC7;display:flex;justify-content:space-between;align-items:center}
.big{font-size:32px;font-weight:800}.muted{color:#5F6B72;font-size:13px}.green{color:#128C4A}
.pad{padding:16px}h1{margin:0;font-size:21px}
</style></head><body>${body}</body></html>`;
}

function khataHtml(v: Awaited<ReturnType<typeof khataView>>) {
  const rows = v.entries
    .map((e) => {
      const label =
        e.type === 'payment'
          ? `Jama kiya${e.method ? ` · ${e.method.toUpperCase()}` : ''}`
          : e.type === 'bill_cancelled'
            ? 'Bill radd hua'
            : `Bill #${String(e.billNumber ?? '').padStart(4, '0')}${e.itemCount ? ` · ${e.itemCount} item` : ''}`;
      const amt = e.amount < 0 ? `<span class="green">− ${esc(formatRupees(-e.amount))}</span>` : esc(formatRupees(e.amount));
      return `<div class="row"><span class="muted">${esc(fmtDate(e.date))}</span><span style="flex:1">${esc(label)}</span><b>${amt}</b></div>`;
    })
    .join('');
  return page(
    `${v.store.name} · Hisaab`,
    `<header>${esc(v.store.name)}</header><main><div class="card">
<div class="pad"><h1>${esc(v.customer.name)}</h1><div class="muted">${esc(v.customer.phone ?? '')}</div></div>
<div class="due"><div><div class="muted"><b>AAPKA BAAKI</b></div><div class="big">${esc(formatRupees(Math.max(v.balance, 0)))}</div></div>
<div class="muted">${esc(fmtDate(v.asOf))} tak<br>ka hisaab</div></div>
<div class="row"><span>Kul kharid</span><b>${esc(formatRupees(v.totalPurchases))}</b></div>
<div class="row"><span>Jama kiya</span><b class="green">${esc(formatRupees(v.totalPaid))}</b></div>
<div class="pad muted"><b>PICHHLA HISAAB</b></div>${rows || '<div class="row muted">Abhi koi entry nahi</div>'}
<div class="pad muted">Aapki jaankari sirf is dukaan ke paas hai.</div></div></main>`,
  );
}

function receiptHtml(v: Awaited<ReturnType<typeof receiptView>>) {
  const rows = v.lines
    .map(
      (l) =>
        `<div class="row"><span>${esc(l.name)}${l.sizeLabel ? ` · ${esc(l.sizeLabel)}` : ''} × ${l.quantity}</span><b>${esc(formatRupees(l.amount))}</b></div>`,
    )
    .join('');
  return page(
    `${v.store.name} · Rasid`,
    `<header>${esc(v.store.name)}</header><main><div class="card">
<div class="pad"><h1>${v.customer ? `Namaste ${esc(v.customer.name)} ji` : 'Rasid'}</h1>
<div class="muted">Rasid · Bill #${String(v.billNumber).padStart(4, '0')} · ${esc(fmtDate(v.date))}${v.store.gstin ? ` · GSTIN ${esc(v.store.gstin)}` : ''}</div></div>
${rows}<div class="row"><span>Total</span><span class="big">${esc(formatRupees(v.total))}</span></div>
${v.balance !== null ? `<div class="due"><div><b style="color:#8A5A00">Udhaar mein likha</b><div class="muted">Aapka kul baaki</div></div><b style="font-size:24px">${esc(formatRupees(v.balance))}</b></div>` : ''}
<div class="pad muted">Dhanyavaad! Kisi galti ke liye dukaan par bataiye.</div></div></main>`,
  );
}

export async function publicApiRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/customers/:token', async (req) => khataView(db, validate(tokenParams, req.params).token));
  app.get('/receipts/:token', async (req) => receiptView(db, validate(tokenParams, req.params).token));

  // "Messages band karo"
  app.post('/customers/:token/opt-out', async (req) => {
    const { customer } = await customerByToken(db, validate(tokenParams, req.params).token);
    await db.update(customers).set({ messagesOptedOutAt: customer.messagesOptedOutAt ?? new Date() }).where(eq(customers.id, customer.id));
    return { messagesOptedOut: true };
  });

  app.post('/customers/:token/opt-in', async (req) => {
    const { customer } = await customerByToken(db, validate(tokenParams, req.params).token);
    await db.update(customers).set({ messagesOptedOutAt: null }).where(eq(customers.id, customer.id));
    return { messagesOptedOut: false };
  });

  // "Meri jaankari hatao": removes personal details at once if nothing is due; otherwise flags the
  // request for the shopkeeper, since the khata has to be settled first.
  app.post('/customers/:token/delete-request', async (req) => {
    const { customer } = await customerByToken(db, validate(tokenParams, req.params).token);
    if (customer.balance === 0) {
      await anonymizeCustomer(db, customer);
      return { deleted: true };
    }
    await db
      .update(customers)
      .set({ deletionRequestedAt: customer.deletionRequestedAt ?? new Date() })
      .where(eq(customers.id, customer.id));
    return { deleted: false, reason: 'BALANCE_DUE', balance: customer.balance };
  });
}

export async function anonymizeCustomer(db: Db, c: Customer) {
  await db
    .update(customers)
    .set({
      name: 'Hataya gaya grahak',
      phone: null,
      shareToken: generateShareToken(),
      messagesOptedOutAt: new Date(),
      anonymizedAt: new Date(),
    })
    .where(eq(customers.id, c.id));
}

export async function publicPageRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const html = (reply: import('fastify').FastifyReply, body: string) =>
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(body);

  app.get('/c/:token', async (req, reply) => {
    try {
      return html(reply, khataHtml(await khataView(db, validate(tokenParams, req.params).token)));
    } catch {
      return html(reply.code(404), page('Not found', '<main><p>Link nahi mila.</p></main>'));
    }
  });

  app.get('/r/:token', async (req, reply) => {
    try {
      return html(reply, receiptHtml(await receiptView(db, validate(tokenParams, req.params).token)));
    } catch {
      return html(reply.code(404), page('Not found', '<main><p>Rasid nahi mili.</p></main>'));
    }
  });
}
