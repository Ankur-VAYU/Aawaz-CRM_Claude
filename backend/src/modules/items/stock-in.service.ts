import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { items, stockReceiptItems, stockReceipts, type Item } from '../../db/schema.js';
import { badRequest, isUniqueViolation } from '../../lib/errors.js';
import { itemDisplayName } from '../../lib/serialize.js';
import type { ParsedLine } from '../assistant/parser.js';
import { resolveLine } from '../bills/matching.js';

export interface ReceiveInput {
  supplier?: string | null;
  note?: string;
  clientId?: string;
  /** itemId for a known item, or name (+ unit) for one not in the inventory yet — it is added. */
  lines: { itemId?: string; name?: string; unit?: 'kg' | 'l' | 'pc'; quantity: number; costPrice?: number | null }[]; // costPrice in paise
}

/**
 * "Maal aaya": adds stock for each line and records the receipt (with optional supplier and cost).
 * Idempotent per clientId, so a retry from a phone on a weak network doesn't add stock twice.
 */
export async function receiveStock(db: Db, storeId: string, input: ReceiveInput) {
  const existing = input.clientId ? await findByClientId(db, storeId, input.clientId) : null;
  if (existing) return { receipt: await getReceipt(db, storeId, existing), duplicate: true };

  const ids = [...new Set(input.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])))];
  if (ids.length) {
    const found = await db.select({ id: items.id }).from(items).where(and(eq(items.storeId, storeId), inArray(items.id, ids)));
    if (found.length !== ids.length) throw badRequest('One or more items were not found');
  }
  if (input.lines.some((l) => !l.itemId && !l.name?.trim())) throw badRequest('Each line needs itemId or name');

  try {
    const id = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // New items come into the inventory here (no selling price yet).
      for (const l of input.lines) {
        if (l.itemId) continue;
        const name = l.name!.trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
        const unit = l.unit ?? 'pc';
        const [created] = await tx.insert(items).values({ storeId, name, unit, unitSize: 1, price: null, stock: 0 }).onConflictDoNothing().returning();
        const item =
          created ??
          (await tx.query.items.findFirst({
            where: and(eq(items.storeId, storeId), eq(items.nameKey, name.toLowerCase()), eq(items.unit, unit), eq(items.unitSize, 1)),
          }));
        l.itemId = item!.id;
      }
      const totalCost = input.lines.reduce((t, l) => t + (l.costPrice != null ? Math.round(l.costPrice * l.quantity) : 0), 0);
      const [receipt] = await tx
        .insert(stockReceipts)
        .values({ storeId, supplier: input.supplier ?? null, note: input.note ?? null, totalCost, clientId: input.clientId ?? null })
        .returning();
      await tx.insert(stockReceiptItems).values(
        input.lines.map((l) => ({ receiptId: receipt.id, itemId: l.itemId!, quantity: l.quantity, costPrice: l.costPrice ?? null })),
      );
      for (const l of input.lines) {
        await tx.update(items).set({ stock: sql`${items.stock} + ${l.quantity}`, isActive: true }).where(eq(items.id, l.itemId!));
      }
      return receipt.id;
    });
    return { receipt: await getReceipt(db, storeId, id), duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err) && input.clientId) {
      const raced = await findByClientId(db, storeId, input.clientId);
      if (raced) return { receipt: await getReceipt(db, storeId, raced), duplicate: true };
    }
    throw err;
  }
}

async function findByClientId(db: Db, storeId: string, clientId: string) {
  const [r] = await db
    .select({ id: stockReceipts.id })
    .from(stockReceipts)
    .where(and(eq(stockReceipts.storeId, storeId), eq(stockReceipts.clientId, clientId)));
  return r?.id ?? null;
}

export async function getReceipt(db: Db, storeId: string, id: string) {
  const r = await db.query.stockReceipts.findFirst({
    where: and(eq(stockReceipts.id, id), eq(stockReceipts.storeId, storeId)),
    with: { items: { with: { item: true } } },
  });
  if (!r) return null;
  return { ...r, items: r.items.map(({ item, ...l }) => ({ ...l, displayName: itemDisplayName(item), stockNow: item.stock })) };
}

export async function listReceipts(db: Db, storeId: string, limit: number) {
  const rows = await db.query.stockReceipts.findMany({
    where: eq(stockReceipts.storeId, storeId),
    orderBy: [desc(stockReceipts.createdAt)],
    limit,
    with: { items: { with: { item: true } } },
  });
  return rows.map((r) => ({ ...r, items: r.items.map(({ item, ...l }) => ({ ...l, displayName: itemDisplayName(item) })) }));
}

/** Matches spoken stock-in lines to the catalogue without changing anything (the app confirms). */
export function previewStockIn(catalog: Item[], lines: ParsedLine[]) {
  const matched: { itemId: string; displayName: string; quantity: number; stock: number }[] = [];
  const unmatched: {
    raw: string;
    options: { itemId?: string; label: string; quantity?: number }[];
    /** Suggested new inventory item, sent back as { name, unit, quantity } to POST /items/receive. */
    newItem: { name: string; unit: 'kg' | 'l' | 'pc'; quantity: number } | null;
  }[] = [];
  for (const line of lines) {
    const r = resolveLine(catalog, line);
    if (r.kind === 'ok') matched.push({ itemId: r.item.id, displayName: itemDisplayName(r.item), quantity: r.quantity, stock: r.item.stock });
    else if (r.issue.kind === 'price_missing' && r.issue.itemId) {
      // Price doesn't matter for receiving stock.
      const item = catalog.find((i) => i.id === r.issue.itemId)!;
      matched.push({ itemId: item.id, displayName: itemDisplayName(item), quantity: r.issue.quantity ?? 1, stock: item.stock });
    } else {
      const name = line.name.trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      const unit = line.measure ? (line.measure.unit === 'g' || line.measure.unit === 'kg' ? 'kg' : 'l') : 'pc';
      const quantity = line.measure
        ? line.measure.value * (line.measure.unit === 'g' || line.measure.unit === 'ml' ? 0.001 : 1) * (line.count ?? 1)
        : (line.count ?? 1);
      unmatched.push({
        raw: r.issue.raw ?? line.raw,
        options: r.issue.options.map(({ itemId, label, quantity: q }) => ({ itemId, label, quantity: q })),
        newItem: !line.unclear && name.replace(/[^\p{L}]/gu, '').length >= 3 ? { name, unit, quantity } : null,
      });
    }
  }
  return { matched, unmatched };
}
