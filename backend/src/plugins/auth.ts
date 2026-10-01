import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { users, type User, type UserRole } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    currentUser: User;
  }
}

interface AuthPluginOptions {
  db: Db;
  secret: string;
  accessTokenTtl: string;
}

export default fp<AuthPluginOptions>(async (app, opts) => {
  await app.register(jwt, { secret: opts.secret, sign: { expiresIn: opts.accessTokenTtl } });

  app.decorateRequest('currentUser', null as unknown as User);

  // Verifies the token and loads the user, so deactivation and role changes take effect immediately
  // instead of waiting for the access token to expire.
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
    const [user] = await opts.db.select().from(users).where(eq(users.id, req.user.sub)).limit(1);
    if (!user || !user.isActive) throw unauthorized('Account is not active');
    req.currentUser = user;
  });

  app.decorate('requireRole', (...roles: UserRole[]) => async (req: FastifyRequest) => {
    await app.authenticate(req);
    if (!roles.includes(req.currentUser.role)) throw forbidden();
  });
});
