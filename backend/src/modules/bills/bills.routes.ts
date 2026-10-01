import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { bills } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { validate } from '../../lib/validate.js';
import { phone } from '../auth/auth.schemas.js';
import type { BillsService } from './bills.service.js';

const paise = z.number().nonnegative().max(10_000_000).transform((r) => Math.round(r * 100));
const quantity = z.number().positive().max(100_000);
const lineInput = z.object({
  itemId: z.uuid().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  quantity,
  /** Rupees; defaults to the item's price. Required for items not in the catalogue. */
  unitPrice: paise.optional(),
});
const paymentMode = z.enum(['cash', 'upi', 'udhaar']);
const clientId = z.string().trim().min(8).max(64);

const createBody = z.object({
  clientId: clientId.optional(),
  customerId: z.uuid().nullable().optional(),
  paymentMode: paymentMode.default('cash'),
  lines: z.array(lineInput).min(1).max(200),
  transcript: z.string().max(2000).optional(),
  source: z.enum(['voice', 'text', 'manual']).optional(),
  confirm: z.boolean().default(false),
});
const updateBody = z
  .object({ customerId: z.uuid().nullable(), paymentMode, lines: z.array(lineInput).min(1).max(200) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');
const resolveBody = z.object({
  issueId: z.uuid(),
  remove: z.boolean().optional(),
  itemId: z.uuid().optional(),
  quantity: quantity.optional(),
  unitPrice: paise.optional(),
  savePrice: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  customerId: z.uuid().optional(),
  newCustomer: z.object({ name: z.string().trim().min(1).max(120), phone: phone.optional() }).optional(),
});
const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
  customerId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export default async function billRoutes(
  app: FastifyInstance,
  { db, billsService }: { db: Db; billsService: BillsService },
) {
  app.addHook('onRequest', app.requireStore);

  app.get('/', async (req) => {
    const q = validate(listQuery, req.query);
    const tz = req.store.timezone;
    const filters: SQL[] = [eq(bills.storeId, req.store.id)];
    if (q.status) filters.push(eq(bills.status, q.status));
    if (q.customerId) filters.push(eq(bills.customerId, q.customerId));
    // from/to are calendar dates in the shop's time zone (inclusive).
    if (q.from) filters.push(gte(bills.createdAt, sql`(${q.from}::date)::timestamp at time zone ${tz}`));
    if (q.to) filters.push(lt(bills.createdAt, sql`((${q.to}::date) + 1)::timestamp at time zone ${tz}`));
    const where = and(...filters);
    const [rows, [{ total }]] = await Promise.all([
      db.query.bills.findMany({
        where,
        orderBy: [desc(bills.createdAt), desc(bills.id)],
        limit: q.limit,
        offset: (q.page - 1) * q.limit,
        with: { customer: { columns: { id: true, name: true } }, items: { columns: { id: true } } },
      }),
      db.select({ total: count() }).from(bills).where(where),
    ]);
    return {
      data: rows.map(({ items, ...b }) => ({ ...b, itemCount: items.length })),
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  });

  // Manual bills and bills queued on the phone while offline (send the same clientId when retrying).
  app.post('/', async (req, reply) => {
    const body = validate(createBody, req.body);
    if (body.confirm === false && !body.lines.length) throw badRequest('Add at least one item');
    const result = await billsService.createManual(req.store, body);
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.get('/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    return { bill: await billsService.get(req.store.id, id) };
  });

  app.patch('/:id', async (req) => {
    const { id } = validate(idParams, req.params);
    const body = validate(updateBody, req.body);
    return { bill: await billsService.updateDraft(req.store, id, body) };
  });

  app.post('/:id/resolve', async (req) => {
    const { id } = validate(idParams, req.params);
    const body = validate(resolveBody, req.body);
    return { bill: await billsService.resolveIssue(req.store, id, body) };
  });

  app.post('/:id/confirm', async (req) => {
    const { id } = validate(idParams, req.params);
    return billsService.confirm(req.store, id);
  });

  app.post('/:id/cancel', async (req) => {
    const { id } = validate(idParams, req.params);
    return { bill: await billsService.cancel(req.store, id) };
  });
}
