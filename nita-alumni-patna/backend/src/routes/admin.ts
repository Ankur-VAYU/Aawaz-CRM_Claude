import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { adminCreateInput, fieldErrors, rejectInput, roleInput } from '../members/schemas.js';
import {
  approveMember, createByAdmin, exportMembersCsv, getFile, getMember, importBatchList, importMembers,
  listAudit, listMembers, rejectMember, setRole, setStatus,
} from '../members/service.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Who did it, for the audit log. Admin sign-in will replace this header later. */
const actorOf = (req: FastifyRequest) => {
  const name = String(req.headers['x-admin-name'] ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 60);
  return name ? `admin:${name}` : 'admin-api';
};

const listQuery = z.object({
  status: z.enum(['pending', 'verified', 'rejected', 'suspended']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const importQuery = z.object({
  dryRun: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  status: z.enum(['pending', 'verified']).default('verified'),
});
const idParams = z.object({ id: z.string() });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Some details need fixing', { fields: fieldErrors(r.error) });
  return r.data;
}

export default async function adminRoutes(app: FastifyInstance, { db, adminKey }: { db: Db; adminKey: string }) {
  const expected = digest(adminKey);

  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-admin-key'];
    const given = typeof header === 'string' ? header : '';
    if (!given || !timingSafeEqual(digest(given), expected)) throw unauthorized('A valid admin key is required');
  });

  const csvBody = (req: FastifyRequest) => {
    if (typeof req.body !== 'string' || !req.body.trim()) throw badRequest('Send the CSV file as the request body with Content-Type: text/csv');
    return req.body;
  };

  app.get('/members', async (req) => listMembers(db, parse(listQuery, req.query)));

  app.get('/members.csv', async (req, reply) => {
    const { status } = parse(listQuery, req.query);
    const csv = await exportMembersCsv(db, status);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="members${status ? '-' + status : ''}.csv"`)
      .send(csv);
  });

  app.post('/members', async (req, reply) => {
    const m = await createByAdmin(db, parse(adminCreateInput, req.body), actorOf(req));
    return reply.code(201).send(m);
  });

  app.post('/members/import', async (req) => {
    const q = parse(importQuery, req.query);
    return importMembers(db, csvBody(req), { ...q, actor: actorOf(req) });
  });

  app.get('/members/:id', async (req) => getMember(db, parse(idParams, req.params).id));

  for (const kind of ['photo', 'proof'] as const) {
    app.get(`/members/:id/${kind}`, async (req, reply) => {
      const f = await getFile(db, parse(idParams, req.params).id, kind);
      return reply.type(f.type).header('cache-control', 'private, no-store').header('content-disposition', 'inline').send(f.data);
    });
  }

  app.post('/members/:id/approve', async (req) => approveMember(db, parse(idParams, req.params).id, actorOf(req)));
  app.post('/members/:id/reject', async (req) =>
    rejectMember(db, parse(idParams, req.params).id, parse(rejectInput, req.body).reason, actorOf(req)),
  );
  app.post('/members/:id/suspend', async (req) => setStatus(db, parse(idParams, req.params).id, 'suspended', actorOf(req)));
  app.post('/members/:id/reinstate', async (req) => setStatus(db, parse(idParams, req.params).id, 'verified', actorOf(req)));
  app.post('/members/:id/role', async (req) => {
    const { role, title } = parse(roleInput, req.body);
    return setRole(db, parse(idParams, req.params).id, role, title, actorOf(req));
  });

  app.post('/batch-list', async (req) => importBatchList(db, csvBody(req), actorOf(req)));

  app.get('/audit', async (req) => listAudit(db, parse(z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }), req.query).limit));
}
