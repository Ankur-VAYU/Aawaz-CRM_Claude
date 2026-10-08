import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { stores, users, type Store, type User } from '../db/schema.js';
import { AppError, unauthorized } from '../lib/errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    requireStore: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    currentUser: User;
    store: Store;
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
  app.decorateRequest('store', null as unknown as Store);

  // Verifies the token and loads the user, so deactivation takes effect immediately
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

  /**
   * Authenticates and loads the shopkeeper's store in one query; every shop endpoint is scoped to it.
   */
  app.decorate('requireStore', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
    const [row] = await opts.db
      .select({ user: users, store: stores })
      .from(users)
      .leftJoin(stores, eq(stores.ownerId, users.id))
      .where(eq(users.id, req.user.sub))
      .limit(1);
    if (!row || !row.user.isActive) throw unauthorized('Account is not active');
    req.currentUser = row.user;
    if (!row.store) throw new AppError(409, 'STORE_NOT_SET_UP', 'Set up your shop first (POST /api/v1/store)');
    req.store = row.store;
  });
});
