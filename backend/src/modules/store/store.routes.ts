import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { items, stores, users, type Store } from '../../db/schema.js';
import { badRequest, conflict, isUniqueViolation } from '../../lib/errors.js';
import { panFromGstin, stateFromGstin } from '../../lib/gst.js';
import { validate } from '../../lib/validate.js';
import { createStoreBody, preferencesBody, taxBody, updateStoreBody } from './store.schemas.js';

async function onboardingStatus(db: Db, store: Store) {
  const [{ itemCount }] = await db
    .select({ itemCount: count() })
    .from(items)
    .where(and(eq(items.storeId, store.id), eq(items.isActive, true)));
  // Mirrors the four steps in the design: Number · Dukaan · Bhasha · Saamaan.
  const steps = {
    number: true,
    shop: true,
    language: store.preferencesSetAt !== null,
    items: itemCount > 0,
  };
  return { steps, itemCount, completed: store.onboardedAt !== null };
}

export default async function storeRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = validate(createStoreBody, req.body);
    try {
      const store = await db.transaction(async (tx) => {
        const [created] = await tx.insert(stores).values({ ...body, ownerId: req.currentUser.id }).returning();
        await tx.update(users).set({ name: body.ownerName }).where(eq(users.id, req.currentUser.id));
        return created;
      });
      return reply.code(201).send({ store, onboarding: await onboardingStatus(db, store) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('You already have a shop set up');
      throw err;
    }
  });

  app.get('/', { onRequest: [app.requireStore] }, async (req) => ({
    store: req.store,
    onboarding: await onboardingStatus(db, req.store),
  }));

  app.patch('/', { onRequest: [app.requireStore] }, async (req) => {
    const body = validate(updateStoreBody, req.body);
    const [store] = await db.update(stores).set(body).where(eq(stores.id, req.store.id)).returning();
    return { store };
  });

  // Optional step: GST number and/or PAN, printed on bills. Send nulls to remove.
  app.put('/tax', { onRequest: [app.requireStore] }, async (req) => {
    const body = validate(taxBody, req.body);
    const update: Partial<Store> = {};
    if (body.gstin !== undefined) {
      update.gstin = body.gstin;
      if (body.gstin) {
        update.pan = panFromGstin(body.gstin);
        update.state = stateFromGstin(body.gstin) ?? req.store.state;
      }
    }
    if (body.pan !== undefined && !body.gstin) update.pan = body.pan;
    if (body.legalName !== undefined) update.legalName = body.legalName;
    if (!Object.keys(update).length) throw badRequest('Provide gstin, pan or legalName');
    const [store] = await db.update(stores).set(update).where(eq(stores.id, req.store.id)).returning();
    return { store };
  });

  app.put('/preferences', { onRequest: [app.requireStore] }, async (req) => {
    const body = validate(preferencesBody, req.body);
    const [store] = await db
      .update(stores)
      .set({ ...body, preferencesSetAt: new Date() })
      .where(eq(stores.id, req.store.id))
      .returning();
    return { store };
  });

  app.post('/onboarding/complete', { onRequest: [app.requireStore] }, async (req) => {
    const status = await onboardingStatus(db, req.store);
    const missing = Object.entries(status.steps)
      .filter(([, done]) => !done)
      .map(([step]) => step);
    if (missing.length) throw badRequest('Finish these steps first', { missing });
    const [store] = await db
      .update(stores)
      .set({ onboardedAt: req.store.onboardedAt ?? new Date() })
      .where(eq(stores.id, req.store.id))
      .returning();
    return { store, onboarding: { ...status, completed: true } };
  });
}
