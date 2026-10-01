import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { validate } from '../../lib/validate.js';
import { dailySummary } from './summary.service.js';

const query = z.object({ date: z.iso.date().optional() });

export default async function summaryRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/daily', { onRequest: [app.requireStore] }, async (req) => {
    const { date } = validate(query, req.query);
    return { summary: await dailySummary(db, req.store, date) };
  });
}
