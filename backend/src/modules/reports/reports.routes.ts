import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { billItems, bills, customers } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { validate } from '../../lib/validate.js';

const query = z.object({ from: z.iso.date(), to: z.iso.date() });
const num = (v: unknown) => Number(v ?? 0);

/**
 * Figures a CA needs for GST returns over a period (dates in the shop's time zone, inclusive):
 * totals by tax rate, by HSN code, B2B invoices, and the invoice number range issued.
 * Cancelled invoices are excluded from the totals and listed separately; credit notes are not
 * supported yet.
 */
export default async function reportRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.addHook('onRequest', app.requireStore);

  app.get('/gst', async (req) => {
    const q = validate(query, req.query);
    if (q.from > q.to) throw badRequest('"from" must be on or before "to"');
    const tz = req.store.timezone;
    const start = sql`(${q.from}::date)::timestamp at time zone ${tz}`;
    const end = sql`((${q.to}::date) + 1)::timestamp at time zone ${tz}`;
    const inPeriod = and(eq(bills.storeId, req.store.id), isNotNull(bills.confirmedAt), gte(bills.confirmedAt, start), lt(bills.confirmedAt, end));
    const issued = and(inPeriod, inArray(bills.status, ['confirmed', 'cancelled']));
    const active = and(inPeriod, eq(bills.status, 'confirmed'), eq(bills.documentType, 'tax_invoice'));

    const [byRate, byHsn, b2b, docs, cancelled] = await Promise.all([
      db
        .select({
          rate: billItems.gstRate,
          invoices: sql`count(distinct ${bills.id})`,
          taxableValue: sql`sum(${billItems.taxableValue})`,
          cgst: sql`sum(${billItems.cgst})`,
          sgst: sql`sum(${billItems.sgst})`,
          igst: sql`sum(${billItems.igst})`,
          total: sql`sum(${billItems.amount})`,
        })
        .from(billItems)
        .innerJoin(bills, eq(bills.id, billItems.billId))
        .where(active)
        .groupBy(billItems.gstRate)
        .orderBy(asc(billItems.gstRate)),
      db
        .select({
          hsnCode: billItems.hsnCode,
          rate: billItems.gstRate,
          quantity: sql`sum(${billItems.quantity})`,
          taxableValue: sql`sum(${billItems.taxableValue})`,
          cgst: sql`sum(${billItems.cgst})`,
          sgst: sql`sum(${billItems.sgst})`,
          igst: sql`sum(${billItems.igst})`,
          total: sql`sum(${billItems.amount})`,
        })
        .from(billItems)
        .innerJoin(bills, eq(bills.id, billItems.billId))
        .where(active)
        .groupBy(billItems.hsnCode, billItems.gstRate)
        .orderBy(asc(billItems.hsnCode), asc(billItems.gstRate)),
      db
        .select({
          invoiceNumber: bills.invoiceNumber,
          date: bills.confirmedAt,
          customerName: customers.name,
          customerGstin: customers.gstin,
          taxableValue: bills.taxableTotal,
          cgst: bills.cgstTotal,
          sgst: bills.sgstTotal,
          igst: bills.igstTotal,
          total: bills.total,
        })
        .from(bills)
        .innerJoin(customers, eq(customers.id, bills.customerId))
        .where(and(active, isNotNull(customers.gstin)))
        .orderBy(asc(bills.confirmedAt)),
      db
        .select({
          documentType: bills.documentType,
          issued: sql`count(*)`,
          cancelled: sql`count(*) filter (where ${bills.status} = 'cancelled')`,
          first: sql<string>`min(${bills.invoiceNumber})`,
          last: sql<string>`max(${bills.invoiceNumber})`,
        })
        .from(bills)
        .where(issued)
        .groupBy(bills.documentType),
      db
        .select({ invoiceNumber: bills.invoiceNumber, date: bills.confirmedAt, cancelledAt: bills.cancelledAt, total: bills.total })
        .from(bills)
        .where(and(inPeriod, eq(bills.status, 'cancelled')))
        .orderBy(asc(bills.confirmedAt)),
    ]);

    const totals = byRate.reduce(
      (t, r) => ({
        taxableValue: t.taxableValue + num(r.taxableValue),
        cgst: t.cgst + num(r.cgst),
        sgst: t.sgst + num(r.sgst),
        igst: t.igst + num(r.igst),
        total: t.total + num(r.total),
      }),
      { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
    );

    return {
      period: { from: q.from, to: q.to },
      store: { gstin: req.store.gstin, gstScheme: req.store.gstScheme },
      totals,
      byRate: byRate.map((r) => ({
        rate: r.rate,
        invoices: num(r.invoices),
        taxableValue: num(r.taxableValue),
        cgst: num(r.cgst),
        sgst: num(r.sgst),
        igst: num(r.igst),
        total: num(r.total),
      })),
      byHsn: byHsn.map((r) => ({
        hsnCode: r.hsnCode,
        rate: r.rate,
        quantity: num(r.quantity),
        taxableValue: num(r.taxableValue),
        cgst: num(r.cgst),
        sgst: num(r.sgst),
        igst: num(r.igst),
        total: num(r.total),
      })),
      b2b,
      documents: docs.map((d) => ({ ...d, issued: num(d.issued), cancelled: num(d.cancelled) })),
      cancelled,
    };
  });
}
