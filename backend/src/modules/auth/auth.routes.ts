import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { forbidden } from '../../lib/errors.js';
import { toPublicUser } from '../../lib/serialize.js';
import { validate } from '../../lib/validate.js';
import {
  changePasswordBody,
  loginBody,
  refreshBody,
  registerBody,
  updateMeBody,
} from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

interface Options {
  db: Db;
  authService: AuthService;
  allowPublicSignup: boolean;
}

// Stricter limits on endpoints that are targets for credential stuffing.
const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export default async function authRoutes(app: FastifyInstance, opts: Options) {
  const { db, authService } = opts;

  app.post('/register', { config: authRateLimit }, async (req, reply) => {
    if (!opts.allowPublicSignup) throw forbidden('Public sign-up is disabled');
    const body = validate(registerBody, req.body);
    const user = await authService.createUser(body);
    const session = await authService.issueSession(user, crypto.randomUUID(), body.deviceName);
    return reply.code(201).send(session);
  });

  app.post('/login', { config: authRateLimit }, async (req) => {
    const body = validate(loginBody, req.body);
    return authService.login(body.email, body.password, body.deviceName);
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

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => ({
    user: toPublicUser(req.currentUser),
  }));

  app.patch('/me', { onRequest: [app.authenticate] }, async (req) => {
    const body = validate(updateMeBody, req.body);
    const [user] = await db
      .update(users)
      .set(body)
      .where(eq(users.id, req.currentUser.id))
      .returning();
    return { user: toPublicUser(user) };
  });

  app.post('/change-password', { onRequest: [app.authenticate], config: authRateLimit }, async (req) => {
    const body = validate(changePasswordBody, req.body);
    return authService.changePassword(
      req.currentUser,
      body.currentPassword,
      body.newPassword,
      body.deviceName,
    );
  });
}
