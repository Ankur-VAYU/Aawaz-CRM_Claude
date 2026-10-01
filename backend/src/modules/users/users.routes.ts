import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { toPublicUser } from '../../lib/serialize.js';
import { validate } from '../../lib/validate.js';
import type { AuthService } from '../auth/auth.service.js';
import {
  createUserBody,
  listUsersQuery,
  resetPasswordBody,
  updateUserBody,
  userIdParams,
} from './users.schemas.js';

interface Options {
  db: Db;
  authService: AuthService;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export default async function userRoutes(app: FastifyInstance, opts: Options) {
  const { db, authService } = opts;
  const canView = { onRequest: [app.requireRole('admin', 'manager')] };
  const adminOnly = { onRequest: [app.requireRole('admin')] };

  app.get('/', canView, async (req) => {
    const q = validate(listUsersQuery, req.query);
    const filters: SQL[] = [];
    if (q.role) filters.push(eq(users.role, q.role));
    if (q.isActive !== undefined) filters.push(eq(users.isActive, q.isActive));
    if (q.search) {
      const pattern = `%${escapeLike(q.search)}%`;
      filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(users.phone, pattern))!);
    }
    const where = filters.length ? and(...filters) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit),
      db.select({ total: count() }).from(users).where(where),
    ]);

    return {
      data: rows.map(toPublicUser),
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  });

  app.get('/:id', canView, async (req) => {
    const { id } = validate(userIdParams, req.params);
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw notFound('User not found');
    return { user: toPublicUser(user) };
  });

  app.post('/', adminOnly, async (req, reply) => {
    const body = validate(createUserBody, req.body);
    const user = await authService.createUser(body);
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.patch('/:id', adminOnly, async (req) => {
    const { id } = validate(userIdParams, req.params);
    const body = validate(updateUserBody, req.body);

    // Prevents an admin from locking themselves (and possibly everyone) out.
    if (id === req.currentUser.id && (body.isActive === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('You cannot deactivate or demote your own account');
    }

    const user = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [updated] = await tx.update(users).set(body).where(eq(users.id, id)).returning();
      if (updated && body.isActive === false) await authService.revokeAllForUser(id, tx);
      return updated;
    });
    if (!user) throw notFound('User not found');
    return { user: toPublicUser(user) };
  });

  app.post('/:id/reset-password', adminOnly, async (req, reply) => {
    const { id } = validate(userIdParams, req.params);
    const { newPassword } = validate(resetPasswordBody, req.body);
    const passwordHash = await hashPassword(newPassword);
    const found = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [updated] = await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, id))
        .returning({ id: users.id });
      if (updated) await authService.revokeAllForUser(id, tx);
      return Boolean(updated);
    });
    if (!found) throw notFound('User not found');
    return reply.code(204).send();
  });
}
