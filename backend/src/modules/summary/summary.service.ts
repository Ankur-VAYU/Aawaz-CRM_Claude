import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { bills, customers, items, ledgerEntries, type Store } from '../../db/schema.js';
import { formatRupees } from '../../lib/money.js';
import { itemDisplayName } from '../../lib/serialize.js';
import { localDate } from '../../lib/time.js';

export { localDate };

/** "Roz ka hisaab": the day's sales, udhaar movement, new customers, low stock and top dues. */
export async function dailySummary(db: Db, store: Store, date = localDate(store.timezone)) {
  const tz = store.timezone;
  const start = sql`(${date}::date)::timestamp at time zone ${tz}`;
  const end = sql`((${date}::date) + 1)::timestamp at time zone ${tz}`;

  const [[sales], [repaid], [newCustomers], lowStock, topDues] = await Promise.all([
    db
      .select({
        bills: sql<number>`count(*)::int`,
        voiceBills: sql<number>`(count(*) filter (where ${bills.source} = 'voice'))::int`,
        total: sql<string>`coalesce(sum(${bills.total}), 0)`,
        paidNow: sql<string>`coalesce(sum(${bills.paidCash} + ${bills.paidUpi}), 0)`,
        cash: sql<string>`coalesce(sum(${bills.paidCash}), 0)`,
        upi: sql<string>`coalesce(sum(${bills.paidUpi}), 0)`,
        udhaarGiven: sql<string>`coalesce(sum(${bills.creditAmount}), 0)`,
      })
      .from(bills)
      .where(and(eq(bills.storeId, store.id), eq(bills.status, 'confirmed'), gte(bills.confirmedAt, start), lt(bills.confirmedAt, end))),
    db
      // Payments minus reversed payments.
      .select({ amount: sql<string>`coalesce(-sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.storeId, store.id),
          inArray(ledgerEntries.type, ['payment', 'payment_reversed']),
          gte(ledgerEntries.createdAt, start),
          lt(ledgerEntries.createdAt, end),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.storeId, store.id), gte(customers.createdAt, start), lt(customers.createdAt, end))),
    db
      .select()
      .from(items)
      .where(and(eq(items.storeId, store.id), eq(items.isActive, true), lte(items.stock, items.lowStockThreshold)))
      .orderBy(asc(items.stock))
      .limit(10),
    db
      .select({ id: customers.id, name: customers.name, balance: customers.balance })
      .from(customers)
      .where(and(eq(customers.storeId, store.id), gt(customers.balance, 0), isNull(customers.anonymizedAt)))
      .orderBy(desc(customers.balance))
      .limit(5),
  ]);

  return {
    date,
    sales: {
      total: Number(sales.total),
      bills: sales.bills,
      voiceBills: sales.voiceBills,
      cashAndUpi: Number(sales.paidNow),
      cash: Number(sales.cash),
      upi: Number(sales.upi),
      udhaarGiven: Number(sales.udhaarGiven),
    },
    udhaarRecovered: Number(repaid.amount),
    newCustomers: newCustomers.n,
    lowStock: lowStock.map((i) => ({
      id: i.id,
      name: itemDisplayName(i),
      stock: i.stock,
      stockLabel: i.stockLabel,
      lowStockThreshold: i.lowStockThreshold,
    })),
    topDues,
  };
}

export function summaryMessage(storeName: string, s: Awaited<ReturnType<typeof dailySummary>>) {
  const lines = [
    `${storeName} · Aaj ki bikri (${s.date})`,
    `${formatRupees(s.sales.total)} · ${s.sales.bills} bill`,
    `Cash + UPI ${formatRupees(s.sales.cashAndUpi)} · Udhaar diya ${formatRupees(s.sales.udhaarGiven)} · Udhaar wapas ${formatRupees(s.udhaarRecovered)}`,
    `Naye grahak: ${s.newCustomers}`,
  ];
  if (s.lowStock.length) lines.push(`Stock kam: ${s.lowStock.map((i) => `${i.name} (${i.stock} ${i.stockLabel})`).join(', ')}`);
  if (s.topDues.length) lines.push(`Sabse zyada udhaar: ${s.topDues.slice(0, 3).map((c) => `${c.name} ${formatRupees(c.balance)}`).join(', ')}`);
  return lines.join('\n');
}
