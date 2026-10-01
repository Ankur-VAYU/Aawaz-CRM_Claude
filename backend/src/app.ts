import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/users.routes.js';
import { AuthService } from './modules/auth/auth.service.js';

type AppConfig = Pick<
  Config,
  'JWT_ACCESS_SECRET' | 'ACCESS_TOKEN_TTL' | 'REFRESH_TOKEN_TTL_DAYS' | 'CORS_ORIGIN' | 'ALLOW_PUBLIC_SIGNUP'
>;

export async function buildApp(
  config: AppConfig,
  db: Db,
  fastifyOpts: FastifyServerOptions = {},
  { rateLimitEnabled = true } = {},
) {
  const app = Fastify({ trustProxy: true, bodyLimit: 1024 * 1024, ...fastifyOpts });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((o) => o.trim()),
  });
  if (rateLimitEnabled) await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin, {
    db,
    secret: config.JWT_ACCESS_SECRET,
    accessTokenTtl: config.ACCESS_TOKEN_TTL,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: 'BAD_REQUEST', message: e.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  );

  app.get('/health', async () => {
    await db.execute(sql`select 1`);
    return { status: 'ok' };
  });

  const authService = new AuthService(app, db, config.REFRESH_TOKEN_TTL_DAYS);
  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        prefix: '/auth',
        db,
        authService,
        allowPublicSignup: config.ALLOW_PUBLIC_SIGNUP,
      });
      await api.register(userRoutes, { prefix: '/users', db, authService });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
