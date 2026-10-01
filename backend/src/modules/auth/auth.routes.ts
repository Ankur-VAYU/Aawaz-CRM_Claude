import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { stores, users } from '../../db/schema.js';
import { validate } from '../../lib/validate.js';
import { refreshBody, requestOtpBody, updateMeBody, verifyOtpBody } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

interface Options {
  db: Db;
  authService: AuthService;
}

// Stricter per-IP limits on endpoints that are targets for abuse.
const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export default async function authRoutes(app: FastifyInstance, opts: Options) {
  const { db, authService } = opts;

  app.post('/otp/request', { config: authRateLimit }, async (req) => {
    const { phone } = validate(requestOtpBody, req.body);
    return authService.requestOtp(phone);
  });

  app.post('/otp/verify', { config: authRateLimit }, async (req) => {
    const body = validate(verifyOtpBody, req.body);
    return authService.verifyOtp(body.phone, body.code, body.deviceName);
  });

  app.post('/refresh', { config: authRateLimit }, async (req) => {
    const { refreshToken } = validate(refreshBody, req.body);
    return authService.refresh(refreshToken);
  });

  app.post('/logout', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { refreshToken } = validate(refreshBody, req.body);
    await authService.logout(refreshToken, req.currentUser.id);
    return reply.code(204).send();
  });

  app.post('/logout-all', { onRequest: [app.authenticate] }, async (req, reply) => {
    await authService.revokeAllForUser(req.currentUser.id);
    return reply.code(204).send();
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const [store] = await db.select().from(stores).where(eq(stores.ownerId, req.currentUser.id)).limit(1);
    return { user: req.currentUser, store: store ?? null };
  });

  app.patch('/me', { onRequest: [app.authenticate] }, async (req) => {
    const body = validate(updateMeBody, req.body);
    const [user] = await db.update(users).set(body).where(eq(users.id, req.currentUser.id)).returning();
    return { user };
  });
}
