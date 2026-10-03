import crypto from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import {
  billItems,
  bills,
  customers,
  items,
  stores,
  type Bill,
  type BillIssue,
  type Customer,
  type Item,
  type Store,
} from '../../db/schema.js';
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors.js';
import { documentTypeFor, financialYear, invoiceNumber, isInterState, lineTax } from '../../lib/gst.js';
import { lineAmount } from '../../lib/money.js';
import { receiptMessage, reply } from '../../lib/replies.js';
import { itemDisplayName, sizeLabel } from '../../lib/serialize.js';
import { localDate } from '../../lib/time.js';
import { generateShareToken } from '../../lib/tokens.js';
import type { PaymentMode, ParsedLine } from '../assistant/parser.js';
import { enqueueCustomerMessage, postLedgerEntry, resolveCustomer, shareLink } from '../customers/customers.service.js';
import { resolveLine } from './matching.js';

export interface LineInput {
  itemId?: string;
  name?: string;
  quantity: number;
  unitPrice?: number; // paise; defaults to the item's price
  gstRate?: number; // percent; for items not in the catalogue
  hsnCode?: string;
}

export interface Upfront {
  amount: number; // paise
  method: 'cash' | 'upi';
}

export interface ResolveInput {
  issueId: string;
  remove?: boolean;
  itemId?: string;
  quantity?: number;
  unitPrice?: number; // paise
  savePrice?: boolean;
  name?: string;
  gstRate?: number;
  customerId?: string;
  newCustomer?: { name: string; phone?: string; messagingConsent?: boolean };
}

interface StoredLine {
  itemId?: string | null;
  name: string;
  sizeLabel?: string | null;
  quantity: number;
  unitPrice: number;
  gstRate?: number | null;
  hsnCode?: string | null;
}

type Tx = Db;
const asTx = (tx: unknown) => tx as Tx;

export class BillsService {
  constructor(
    private readonly db: Db,
    private readonly publicBaseUrl: string,
  ) {}

  private async catalog(tx: Tx, storeId: string) {
    return tx.select().from(items).where(and(eq(items.storeId, storeId), eq(items.isActive, true)));
  }

  private receiptLink(bill: Pick<Bill, 'receiptToken'>) {
    return `${this.publicBaseUrl.replace(/\/$/, '')}/r/${bill.receiptToken}`;
  }

  /** Bill with its lines and customer, as returned by the API. */
  async get(storeId: string, billId: string, tx: Tx = this.db) {
    const bill = await tx.query.bills.findFirst({
      where: and(eq(bills.id, billId), eq(bills.storeId, storeId)),
      with: { items: { orderBy: [asc(billItems.position)] }, customer: true },
    });
    if (!bill) throw notFound('Bill not found');
    const { customer, ...rest } = bill;
    return {
      ...rest,
      customer: customer
        ? { id: customer.id, name: customer.name, phone: customer.phone, gstin: customer.gstin, balance: customer.balance }
        : null,
      itemCount: bill.items.length,
      canConfirm: bill.status === 'draft' && bill.issues.length === 0 && bill.items.length > 0,
      receiptLink: this.receiptLink(bill),
    };
  }

  /** Builds a draft from a parsed voice/text command. Nothing changes in stock or khata until confirm. */
  async createDraftFromSpeech(
    store: Store,
    input: { customerName: string | null; paymentMode: PaymentMode; lines: ParsedLine[]; upfront?: Upfront },
    meta: { transcript: string; source: 'voice' | 'text'; clientId?: string },
  ) {
    if (meta.clientId) {
      const existing = await this.findByClientId(store.id, meta.clientId);
      if (existing) return this.get(store.id, existing.id);
    }
    const catalog = await this.catalog(this.db, store.id);
    const resolved = input.lines.map((l) => resolveLine(catalog, l));
    const issues: BillIssue[] = resolved.flatMap((r) => (r.kind === 'issue' ? [r.issue] : []));
    const lines: StoredLine[] = resolved.flatMap((r) => (r.kind === 'ok' ? [this.lineFromItem(r.item, r.quantity, r.item.price!)] : []));

    let customerId: string | null = null;
    if (input.customerName) {
      const match = await resolveCustomer(this.db, store.id, input.customerName);
      if (match.status === 'found') customerId = match.customer.id;
      else if (match.status === 'ambiguous') {
        issues.unshift({
          id: crypto.randomUUID(),
          kind: 'customer_ambiguous',
          name: input.customerName,
          options: match.candidates.map((c) => ({ customerId: c.id, label: c.name })),
        });
      } else {
        issues.unshift({ id: crypto.randomUUID(), kind: 'customer_unknown', name: input.customerName, options: [] });
      }
    } else if (input.paymentMode === 'udhaar') {
      issues.unshift({ id: crypto.randomUUID(), kind: 'customer_required', options: [] });
    }

    return this.insertBill(store, {
      customerId,
      spokenCustomerName: customerId ? null : input.customerName,
      paymentMode: input.paymentMode,
      upfront: input.upfront,
      lines,
      issues,
      source: meta.source,
      transcript: meta.transcript,
      clientId: meta.clientId,
    });
  }

  /** Manual / offline-queued bill with explicit lines. Idempotent per `clientId`. */
  async createManual(
    store: Store,
    input: {
      clientId?: string;
      customerId?: string | null;
      paymentMode: PaymentMode;
      upfront?: Upfront;
      lines: LineInput[];
      transcript?: string;
      source?: 'voice' | 'text' | 'manual';
      confirm?: boolean;
    },
  ) {
    if (input.clientId) {
      const existing = await this.findByClientId(store.id, input.clientId);
      if (existing) return { bill: await this.get(store.id, existing.id), duplicate: true, effects: null };
    }
    if (input.customerId) await this.loadCustomer(this.db, store.id, input.customerId);
    const catalog = await this.catalog(this.db, store.id);
    const bill = await this.insertBill(store, {
      customerId: input.customerId ?? null,
      spokenCustomerName: null,
      paymentMode: input.paymentMode,
      upfront: input.upfront,
      lines: this.checkLines(input.lines, catalog),
      issues: [],
      source: input.source ?? 'manual',
      transcript: input.transcript ?? null,
      clientId: input.clientId,
    });
    if (!input.confirm) return { bill, duplicate: false, effects: null };
    const confirmed = await this.confirm(store, bill.id);
    return { ...confirmed, duplicate: false };
  }

  private async findByClientId(storeId: string, clientId: string) {
    const [b] = await this.db
      .select({ id: bills.id })
      .from(bills)
      .where(and(eq(bills.storeId, storeId), eq(bills.clientId, clientId)));
    return b;
  }

  private async loadCustomer(tx: Tx, storeId: string, customerId: string) {
    const [c] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId), isNull(customers.anonymizedAt)));
    if (!c) throw badRequest('Customer not found');
    return c;
  }

  private lineFromItem(item: Item, quantity: number, unitPrice: number): StoredLine {
    return {
      itemId: item.id,
      name: item.name,
      sizeLabel: sizeLabel(item),
      quantity,
      unitPrice,
      gstRate: item.gstRate,
      hsnCode: item.hsnCode,
    };
  }

  /** Validates explicit lines against the catalogue and fills in prices and tax details. */
  private checkLines(lines: LineInput[], catalog: Item[]): StoredLine[] {
    const byId = new Map(catalog.map((i) => [i.id, i]));
    return lines.map((l, idx) => {
      if (l.itemId) {
        const item = byId.get(l.itemId);
        if (!item) throw badRequest(`Line ${idx + 1}: item not found`);
        const unitPrice = l.unitPrice ?? item.price;
        if (unitPrice === null || unitPrice === undefined) throw badRequest(`Line ${idx + 1}: ${item.name} has no price`);
        return this.lineFromItem(item, l.quantity, unitPrice);
      }
      if (!l.name || l.unitPrice === undefined) throw badRequest(`Line ${idx + 1}: give itemId, or name and unitPrice`);
      return { name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, gstRate: l.gstRate ?? null, hsnCode: l.hsnCode ?? null };
    });
  }

  private async insertBill(
    store: Store,
    b: {
      customerId: string | null;
      spokenCustomerName: string | null;
      paymentMode: PaymentMode;
      upfront?: Upfront;
      lines: StoredLine[];
      issues: BillIssue[];
      source: 'voice' | 'text' | 'manual';
      transcript: string | null;
      clientId?: string;
    },
  ) {
    try {
      const id = await this.db.transaction(async (txRaw) => {
        const tx = asTx(txRaw);
        const [bill] = await tx
          .insert(bills)
          .values({
            storeId: store.id,
            customerId: b.customerId,
            spokenCustomerName: b.spokenCustomerName,
            paymentMode: b.paymentMode,
            upfrontAmount: b.paymentMode === 'udhaar' ? (b.upfront?.amount ?? 0) : 0,
            upfrontMethod: b.paymentMode === 'udhaar' ? (b.upfront?.method ?? null) : null,
            issues: b.issues,
            source: b.source,
            transcript: b.transcript,
            clientId: b.clientId ?? null,
            receiptToken: generateShareToken(),
          })
          .returning();
        await this.writeLines(tx, store, bill.id, b.lines);
        return bill.id;
      });
      return this.get(store.id, id);
    } catch (err) {
      // Two offline retries racing with the same clientId.
      if (isUniqueViolation(err) && b.clientId) {
        const existing = await this.findByClientId(store.id, b.clientId);
        if (existing) return this.get(store.id, existing.id);
      }
      throw err;
    }
  }

  private async writeLines(tx: Tx, store: Store, billId: string, lines: StoredLine[]) {
    await tx.delete(billItems).where(eq(billItems.billId, billId));
    if (lines.length) {
      await tx.insert(billItems).values(
        lines.map((l, position) => ({
          billId,
          position,
          itemId: l.itemId ?? null,
          name: l.name,
          sizeLabel: l.sizeLabel ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          gstRate: l.gstRate ?? null,
          hsnCode: l.hsnCode ?? null,
          amount: lineAmount(l.unitPrice, l.quantity),
        })),
      );
    }
    await this.recalc(tx, store, billId);
  }

  /**
   * Recomputes every line's amount and tax and the bill totals from the shop's current GST setup
   * and the bill's customer. Runs after every draft change and again on confirm.
   */
  private async recalc(tx: Tx, store: Store, billId: string) {
    const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
    const customer = bill.customerId ? await this.loadCustomer(tx, store.id, bill.customerId) : null;
    const docType = documentTypeFor(store);
    const interState = isInterState(store.gstin, customer?.gstin ?? null);
    const lines = await tx.select().from(billItems).where(eq(billItems.billId, billId));
    const totals = { total: 0, taxableTotal: 0, cgstTotal: 0, sgstTotal: 0, igstTotal: 0 };
    for (const l of lines) {
      const gross = lineAmount(l.unitPrice, l.quantity);
      const t =
        docType === 'tax_invoice' && l.gstRate !== null
          ? lineTax(gross, l.gstRate, { inclusive: store.pricesIncludeTax, interState })
          : { amount: gross, taxableValue: gross, cgst: 0, sgst: 0, igst: 0 };
      await tx.update(billItems).set(t).where(eq(billItems.id, l.id));
      totals.total += t.amount;
      totals.taxableTotal += t.taxableValue;
      totals.cgstTotal += t.cgst;
      totals.sgstTotal += t.sgst;
      totals.igstTotal += t.igst;
    }
    await tx.update(bills).set(totals).where(eq(bills.id, billId));
    return { ...totals, docType, lines };
  }

  private async lockDraft(tx: Tx, storeId: string, billId: string) {
    const [bill] = await tx
      .select()
      .from(bills)
      .where(and(eq(bills.id, billId), eq(bills.storeId, storeId)))
      .for('update');
    if (!bill) throw notFound('Bill not found');
    if (bill.status !== 'draft') throw conflict(`Bill is already ${bill.status}`, 'BILL_NOT_DRAFT');
    return bill;
  }

  private async currentLines(tx: Tx, billId: string): Promise<StoredLine[]> {
    return tx.select().from(billItems).where(eq(billItems.billId, billId)).orderBy(asc(billItems.position));
  }

  /** Edits a draft ("Badlo"): customer, payment mode, part payment and/or the full list of lines. */
  async updateDraft(
    store: Store,
    billId: string,
    patch: { customerId?: string | null; paymentMode?: PaymentMode; upfront?: Upfront | null; lines?: LineInput[] },
  ) {
    await this.db.transaction(async (txRaw) => {
      const tx = asTx(txRaw);
      const bill = await this.lockDraft(tx, store.id, billId);
      const update: Partial<Bill> = {};
      let issues = bill.issues;
      if (patch.customerId !== undefined) {
        if (patch.customerId) await this.loadCustomer(tx, store.id, patch.customerId);
        update.customerId = patch.customerId;
        update.spokenCustomerName = null;
        issues = issues.filter((i) => !i.kind.startsWith('customer_'));
      }
      if (patch.paymentMode) update.paymentMode = patch.paymentMode;
      const mode = update.paymentMode ?? bill.paymentMode;
      if (patch.upfront !== undefined) {
        update.upfrontAmount = patch.upfront?.amount ?? 0;
        update.upfrontMethod = patch.upfront?.method ?? null;
      }
      if (mode !== 'udhaar') {
        update.upfrontAmount = 0;
        update.upfrontMethod = null;
      }
      const customerId = update.customerId !== undefined ? update.customerId : bill.customerId;
      if (mode === 'udhaar' && !customerId && !issues.some((i) => i.kind.startsWith('customer_'))) {
        issues = [{ id: crypto.randomUUID(), kind: 'customer_required', options: [] }, ...issues];
      }
      if (mode !== 'udhaar') issues = issues.filter((i) => i.kind !== 'customer_required');
      if (patch.lines) issues = issues.filter((i) => i.kind.startsWith('customer_'));
      await tx.update(bills).set({ ...update, issues }).where(eq(bills.id, billId));

      if (patch.lines) {
        const catalog = await this.catalog(tx, store.id);
        await this.writeLines(tx, store, billId, this.checkLines(patch.lines, catalog));
      } else {
        await this.recalc(tx, store, billId); // customer change can switch CGST/SGST <-> IGST
      }
    });
    return this.get(store.id, billId);
  }

  /** Answers one open question on a draft, e.g. picks "1 litre · ₹170" for "Kaunsa size?". */
  async resolveIssue(store: Store, billId: string, input: ResolveInput) {
    await this.db.transaction(async (txRaw) => {
      const tx = asTx(txRaw);
      const bill = await this.lockDraft(tx, store.id, billId);
      const issue = bill.issues.find((i) => i.id === input.issueId);
      if (!issue) throw notFound('Issue not found on this bill');
      let issues = bill.issues.filter((i) => i.id !== issue.id);
      const update: Partial<Bill> = {};
      let lines: StoredLine[] | null = null;

      if (issue.kind.startsWith('customer_')) {
        if (input.remove) {
          if (bill.paymentMode === 'udhaar') throw badRequest('An udhaar bill needs a customer');
          update.spokenCustomerName = null;
        } else if (input.customerId) {
          await this.loadCustomer(tx, store.id, input.customerId);
          update.customerId = input.customerId;
          update.spokenCustomerName = null;
        } else if (input.newCustomer) {
          try {
            const [c] = await tx
              .insert(customers)
              .values({
                storeId: store.id,
                name: input.newCustomer.name,
                phone: input.newCustomer.phone ?? null,
                shareToken: generateShareToken(),
                ...(input.newCustomer.messagingConsent
                  ? { messagingConsentAt: new Date(), messagingConsentSource: 'shopkeeper' }
                  : {}),
              })
              .returning();
            update.customerId = c.id;
            update.spokenCustomerName = null;
          } catch (err) {
            if (isUniqueViolation(err)) throw conflict('A customer with this phone number already exists');
            throw err;
          }
        } else {
          throw badRequest('Give customerId or newCustomer (or remove: true)');
        }
      } else if (!input.remove) {
        const catalog = await this.catalog(tx, store.id);
        const itemId = input.itemId ?? issue.itemId;
        lines = await this.currentLines(tx, billId);
        if (itemId) {
          const item = catalog.find((i) => i.id === itemId);
          if (!item) throw badRequest('Item not found');
          const chosen = issue.options.find((o) => o.itemId === itemId);
          const quantity = input.quantity ?? chosen?.quantity ?? issue.quantity ?? 1;
          const unitPrice = input.unitPrice ?? item.price;
          if (unitPrice === null || unitPrice === undefined) {
            // Still no price: turn it into a price question instead of failing.
            issues = [
              ...issues,
              { id: crypto.randomUUID(), kind: 'price_missing', raw: issue.raw, name: itemDisplayName(item), itemId: item.id, quantity, options: [] },
            ];
          } else {
            if (input.savePrice && input.unitPrice !== undefined) {
              await tx.update(items).set({ price: input.unitPrice }).where(eq(items.id, item.id));
            }
            lines.push(this.lineFromItem(item, quantity, unitPrice));
          }
        } else if (input.name && input.unitPrice !== undefined) {
          lines.push({
            name: input.name,
            quantity: input.quantity ?? issue.quantity ?? 1,
            unitPrice: input.unitPrice,
            gstRate: input.gstRate ?? null,
          });
        } else {
          throw badRequest('Give itemId, or name and unitPrice (or remove: true)');
        }
      }
      await tx.update(bills).set({ ...update, issues }).where(eq(bills.id, billId));
      if (lines) await this.writeLines(tx, store, billId, lines);
      else await this.recalc(tx, store, billId);
    });
    return this.get(store.id, billId);
  }

  /**
   * "Haan, pakka karo": gives the bill its invoice number, reduces stock, records how it was paid,
   * adds any udhaar to the khata and queues a receipt for udhaar bills.
   */
  async confirm(storeArg: Store, billId: string) {
    const result = await this.db.transaction(async (txRaw) => {
      const tx = asTx(txRaw);
      const bill = await this.lockDraft(tx, storeArg.id, billId);
      if (bill.issues.length) {
        throw new AppError(409, 'BILL_HAS_ISSUES', 'Some items still need your answer', { issues: bill.issues });
      }
      // Lock the store row: serialises invoice numbering and uses the latest GST settings.
      const [store] = await tx.select().from(stores).where(eq(stores.id, storeArg.id)).for('update');
      const calc = await this.recalc(tx, store, billId);
      if (!calc.lines.length) throw badRequest('The bill has no items');
      if (calc.docType === 'tax_invoice') {
        const missing = calc.lines.filter((l) => l.gstRate === null).map((l) => l.name);
        if (missing.length) {
          throw new AppError(409, 'GST_RATE_MISSING', 'Set the GST rate for these items first', { items: missing });
        }
      }

      const total = calc.total;
      let paidCash = 0;
      let paidUpi = 0;
      let creditAmount = 0;
      if (bill.paymentMode === 'cash') paidCash = total;
      else if (bill.paymentMode === 'upi') paidUpi = total;
      else {
        if (!store.givesCredit) throw badRequest('Udhaar is turned off for this shop');
        if (!bill.customerId) throw badRequest('An udhaar bill needs a customer');
        if (bill.upfrontAmount >= total) throw badRequest('The amount paid covers the whole bill; use cash or UPI instead');
        if (bill.upfrontMethod === 'upi') paidUpi = bill.upfrontAmount;
        else paidCash = bill.upfrontAmount;
        creditAmount = total - bill.upfrontAmount;
      }

      const fy = financialYear(localDate(store.timezone));
      const [{ seq }] = await tx
        .update(stores)
        .set({
          billCounter: sql`case when ${stores.billCounterFy} = ${fy} then ${stores.billCounter} + 1 else 1 end`,
          billCounterFy: fy,
        })
        .where(eq(stores.id, store.id))
        .returning({ seq: stores.billCounter });
      const number = invoiceNumber(fy, seq);

      const stocked = calc.lines.filter((l) => l.itemId);
      for (const l of stocked) {
        await tx.update(items).set({ stock: sql`${items.stock} - ${l.quantity}` }).where(eq(items.id, l.itemId!));
      }

      let khata: { before: number; after: number } | null = null;
      let customer: Customer | null = null;
      if (bill.customerId) {
        [customer] = await tx
          .update(customers)
          .set({
            lastPurchaseAt: new Date(),
            totalPurchases: sql`${customers.totalPurchases} + ${total}`,
            totalPaid: sql`${customers.totalPaid} + ${paidCash + paidUpi}`,
          })
          .where(eq(customers.id, bill.customerId))
          .returning();
        if (creditAmount > 0) {
          const posted = await postLedgerEntry(tx, {
            storeId: store.id,
            customerId: bill.customerId,
            type: 'bill',
            amount: creditAmount,
            billId,
          });
          khata = { before: posted.balanceBefore, after: posted.customer.balance };
          customer = posted.customer;
        }
      }

      await tx
        .update(bills)
        .set({
          status: 'confirmed',
          billNumber: seq,
          invoiceNumber: number,
          documentType: calc.docType,
          placeOfSupply: store.state,
          paidCash,
          paidUpi,
          creditAmount,
          confirmedAt: new Date(),
        })
        .where(eq(bills.id, billId));

      // Receipts go out for udhaar bills only (a cost decision), and only with the customer's consent.
      let receiptQueued = false;
      if (customer && creditAmount > 0) {
        const lines = await tx.select().from(billItems).where(eq(billItems.billId, billId)).orderBy(asc(billItems.position));
        receiptQueued = await enqueueCustomerMessage(
          tx,
          store,
          customer,
          'receipt',
          receiptMessage({
            storeName: store.name,
            customerName: customer.name,
            invoiceNumber: number,
            lines: lines.map((l) => ({ name: l.name, sizeLabel: l.sizeLabel, quantity: l.quantity, amount: l.amount })),
            total,
            paidNow: paidCash + paidUpi,
            credit: creditAmount,
            balance: customer.balance,
            link: this.receiptLink(bill),
          }),
          { billId },
        );
      }
      return { store, stockReduced: stocked.length, khata, receiptQueued, customer };
    });

    const lang = result.store.language;
    const messages = [reply(lang, 'billConfirmed')];
    if (result.stockReduced) messages.push(reply(lang, 'stockReduced', { n: result.stockReduced }));
    if (result.khata && result.customer) {
      messages.push(reply(lang, 'khataChanged', { name: result.customer.name.split(' ')[0], ...result.khata }));
    }
    if (result.receiptQueued && result.customer) {
      messages.push(reply(lang, 'receiptSent', { name: result.customer.name.split(' ')[0] }));
    }
    return {
      bill: await this.get(storeArg.id, billId),
      effects: {
        stockReduced: result.stockReduced,
        khata: result.khata,
        receiptQueued: result.receiptQueued,
        customerLink: result.customer ? shareLink(this.publicBaseUrl, result.customer) : null,
      },
      reply: { title: messages[0], lines: messages.slice(1) },
    };
  }

  /**
   * Discards a draft, or cancels a confirmed bill: restores stock and reverses the khata entry.
   * The invoice number is not reused; the cancelled invoice stays on record.
   */
  async cancel(store: Store, billId: string) {
    await this.db.transaction(async (txRaw) => {
      const tx = asTx(txRaw);
      const [bill] = await tx
        .select()
        .from(bills)
        .where(and(eq(bills.id, billId), eq(bills.storeId, store.id)))
        .for('update');
      if (!bill) throw notFound('Bill not found');
      if (bill.status === 'cancelled') throw conflict('Bill is already cancelled', 'BILL_NOT_DRAFT');
      if (bill.status === 'confirmed') {
        const lines = await tx.select().from(billItems).where(eq(billItems.billId, billId));
        for (const l of lines.filter((x) => x.itemId)) {
          await tx.update(items).set({ stock: sql`${items.stock} + ${l.quantity}` }).where(eq(items.id, l.itemId!));
        }
        if (bill.customerId) {
          await tx
            .update(customers)
            .set({
              totalPurchases: sql`${customers.totalPurchases} - ${bill.total}`,
              totalPaid: sql`${customers.totalPaid} - ${bill.paidCash + bill.paidUpi}`,
            })
            .where(eq(customers.id, bill.customerId));
          if (bill.creditAmount > 0) {
            await postLedgerEntry(tx, {
              storeId: store.id,
              customerId: bill.customerId,
              type: 'bill_cancelled',
              amount: -bill.creditAmount,
              billId,
              note: `Bill ${bill.invoiceNumber} cancelled`,
            });
          }
        }
      }
      await tx.update(bills).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(bills.id, billId));
    });
    return this.get(store.id, billId);
  }
}
