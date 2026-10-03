import Fastify, { type FastifyServerOptions } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Db } from './db/index.js';
import { AppError } from './lib/errors.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

export interface AppOptions {
  adminKey: string;
  trustProxy?: boolean;
  rateLimit?: boolean;
  fastify?: FastifyServerOptions;
}

export async function buildApp(db: Db, opts: AppOptions) {
  const app = Fastify({ trustProxy: opts.trustProxy ?? true, bodyLimit: 1024 * 1024, ...opts.fastify });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: false, max: 120, timeWindow: '1 minute' });
  if (opts.rateLimit !== false) {
    // Admin API: generous limit, mainly to slow down guessing of the admin key.
    app.addHook('onRoute', (route) => {
      if (route.url.startsWith('/api/v1/admin') && !route.config?.rateLimit) {
        route.config = { ...route.config, rateLimit: { max: 120, timeWindow: '1 minute' } };
      }
    });
  } else {
    app.addHook('onRoute', (route) => {
      route.config = { ...route.config, rateLimit: false };
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const details = (err.details ?? {}) as Record<string, unknown>;
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...details });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.statusCode && e.statusCode < 500) {
      const message =
        e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'The upload is too large. Use a smaller photo or document.' : (e.message ?? 'Bad request');
      return reply.code(e.statusCode).send({ error: e.code ?? 'BAD_REQUEST', message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' });
  });

  await app.register(publicRoutes, { db });
  await app.register(adminRoutes, { prefix: '/api/v1/admin', db, adminKey: opts.adminKey });
  return app;
}
