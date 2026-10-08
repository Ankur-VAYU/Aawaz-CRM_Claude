import { and, asc, eq, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { lockStore } from '../../db/locks.js';
import { items } from '../../db/schema.js';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors.js';
import { itemDisplayName } from '../../lib/serialize.js';
import { validate } from '../../lib/validate.js';
import { getReceipt, listReceipts, receiveStock } from './stock-in.service.js';

const rupeesToPaise = z.number().nonnegative().max(10_000_000).transform((r) => Math.round(r * 100));

const itemFields = {
  name: z.string().trim().min(1).max(80),
  aliases: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  unit: z.enum(['kg', 'g', 'l', 'ml', 'pc']).default('pc'),
  unitSize: z.number().positive().max(100_000).default(1),
  /** Price per pack in rupees; null if not known yet. */
  price: rupeesToPaise.nullable().default(null),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, 'HSN code must be 4–8 digits').nullable().default(null),
  /** GST % (e.g. 0, 5, 18). Needed for tax invoices; confirm the rate for each product with a CA. */
  gstRate: z.number().min(0).max(40).multipleOf(0.01).nullable().default(null),
  stock: z.number().min(0).max(1_000_000).default(0),
  stockLabel: z.string().trim().min(1).max(20).default('pc'),
  lowStockThreshold: z.number().min(0).max(1_000_000).default(5),
};

const createItemBody = z.object(itemFields);
const bulkBody = z.object({ items: z.array(createItemBody).min(1).max(500) });
const updateItemBody = z
  .object({
    name: itemFields.name,
    aliases: z.array(z.string().trim().min(1).max(80)).max(10),
    unit: z.enum(['kg', 'g', 'l', 'ml', 'pc']),
    unitSize: z.number().positive().max(100_000),
    price: rupeesToPaise.nullable(),
    hsnCode: z.string().trim().regex(/^\d{4,8}$/, 'HSN code must be 4–8 digits').nullable(),
    gstRate: z.number().min(0).max(40).multipleOf(0.01).nullable(),
    stock: z.number().min(0).max(1_000_000),
    stockLabel: itemFields.stockLabel,
    lowStockThreshold: z.number().min(0).max(1_000_000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');
// Stock adjustments are deltas so two devices restocking at once don't overwrite each other.
const adjustStockBody = z.object({ delta: z.number().min(-1_000_000).max(1_000_000) });
const idParams = z.object({ id: z.uuid() });
const receiveBody = z.object({
  supplier: z.string().trim().min(1).max(120).nullable().optional(),
  note: z.string().trim().max(200).optional(),
  clientId: z.string().trim().min(8).max(64).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.uuid().optional(),
        /** For an item not in the inventory yet: it is added (selling price can be set later). */
        name: z.string().trim().min(1).max(80).optional(),
        unit: z.enum(['kg', 'l', 'pc']).optional(),
        quantity: z.number().positive().max(1_000_000),
        /** Purchase price per pack in rupees (optional, for margins later). */
        costPrice: z.number().nonnegative().max(10_000_000).transform((r) => Math.round(r * 100)).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});
const receiptsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  includeInactive: z.enum(['true', 'false']).default('false'),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const present = <T extends typeof items.$inferSelect>(item: T) => ({ ...item, displayName: itemDisplayName(item) });
const duplicate = () => conflict('This item with the same size already exists');

export default async function itemRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.addHook('onRequest', app.requireStore);

  app.get('/', async (req) => {
    const q = validate(listQuery, req.query);
    const filters: SQL[] = [eq(items.storeId, req.store.id)];
    if (q.includeInactive === 'false') filters.push(eq(items.isActive, true));
    if (q.search) {
      const p = `%${escapeLike(q.search)}%`;
      filters.push(or(ilike(items.name, p), sql`array_to_string(${items.aliases}, ' ') ilike ${p}`)!);
    }
    const rows = await db.select().from(items).where(and(...filters)).orderBy(asc(items.name), asc(items.unitSize));
    return { data: rows.map(present) };
  });

  // "Stock kam hai" / "Kal ki kharid list"
  app.get('/low-stock', async (req) => {
    const rows = await db
      .select()
      .from(items)
      .where(and(eq(items.storeId, req.store.id), eq(items.isActive, true), lte(items.stock, items.lowStockThreshold)))
      .orderBy(asc(items.stock));
    return { data: rows.map(present) };
  });

  app.post('/', async (req, reply) => {
    const body = validate(createItemBody, req.body);
    try {
      const [item] = await db.insert(items).values({ ...body, storeId: req.store.id }).returning();
      return reply.code(201).send({ item: present(item) });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }
  });

  // Onboarding: add many items at once (from voice, a shelf photo or an uploaded list, parsed on the app side).
  // Existing variants (same name + size) are updated rather than duplicated.
  app.post('/bulk', async (req, reply) => {
    const { items: input } = validate(bulkBody, req.body);
    const rows = await db.transaction(async (tx) => {
      await lockStore(tx as unknown as Db, req.store.id);
      // One statement for the whole list. The same variant twice in one upload keeps the last one
      // (PostgreSQL cannot update a row twice in a single INSERT ... ON CONFLICT).
      const key = (i: { name: string; unit: string; unitSize: number }) => `${i.name.toLowerCase()}|${i.unit}|${i.unitSize}`;
      const unique = [...new Map(input.map((i) => [key(i), i])).values()];
      const out = await tx
          .insert(items)
          .values(unique.map((item) => ({ ...item, storeId: req.store.id })))
          .onConflictDoUpdate({
            target: [items.storeId, items.nameKey, items.unit, items.unitSize],
            set: {
              price: sql`coalesce(excluded.price, ${items.price})`,
              hsnCode: sql`coalesce(excluded.hsn_code, ${items.hsnCode})`,
              gstRate: sql`coalesce(excluded.gst_rate, ${items.gstRate})`,
              stock: sql`excluded.stock`,
              stockLabel: sql`excluded.stock_label`,
              aliases: sql`excluded.aliases`,
              isActive: true,
            },
          })
          .returning();
      const order = new Map(unique.map((i, k) => [key(i), k]));
      return out.sort((a, b) => order.get(key({ ...a, unitSize: Number(a.unitSize) }))! - order.get(key({ ...b, unitSize: Number(b.unitSize) }))!);
    });
    return reply.code(201).send({ data: rows.map(present), missingPrice: rows.filter((r) => r.price === null).length });
  });

  // "Maal aaya": receive stock for several items at once.
  app.post('/receive', async (req, reply) => {
    const body = validate(receiveBody, req.body);
    const result = await receiveStock(db, req.store.id, body);
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.get('/receipts', async (req) => {
    const { limit } = validate(receiptsQuery, req.query);
    return { data: await listReceipts(db, req.store.id, limit) };
  });

  app.get('/receipts/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    const receipt = await getReceipt(db, req.store.id, id);
    if (!receipt) throw notFound('Stock receipt not found');
    return { receipt };
  });

  app.get('/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    const [item] = await db.select().from(items).where(and(eq(items.id, id), eq(items.storeId, req.store.id)));
    if (!item) throw notFound('Item not found');
    return { item: present(item) };
  });

  app.patch('/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    const body = validate(updateItemBody, req.body);
    try {
      const [item] = await db
        .update(items)
        .set(body)
        .where(and(eq(items.id, id), eq(items.storeId, req.store.id)))
        .returning();
      if (!item) throw notFound('Item not found');
      return { item: present(item) };
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }
  });

  app.post('/:id/stock', async (req) => {
    const { id } = validate(idParams, req.params);
    const { delta } = validate(adjustStockBody, req.body);
    const [item] = await db
      .update(items)
      .set({ stock: sql`${items.stock} + ${delta}` })
      .where(and(eq(items.id, id), eq(items.storeId, req.store.id)))
      .returning();
    if (!item) throw notFound('Item not found');
    return { item: present(item) };
  });

  // Items are deactivated, not deleted, so old bills keep their link.
  app.delete('/:id', async (req, reply) => {
    const { id } = validate(idParams, req.params);
    const [item] = await db
      .update(items)
      .set({ isActive: false })
      .where(and(eq(items.id, id), eq(items.storeId, req.store.id)))
      .returning({ id: items.id });
    if (!item) throw notFound('Item not found');
    return reply.code(204).send();
  });
}
