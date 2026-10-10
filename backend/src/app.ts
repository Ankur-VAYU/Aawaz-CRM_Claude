import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { AppError } from './lib/errors.js';
import type { MessageSender } from './messaging/sender.js';
import authPlugin from './plugins/auth.js';
import assistantRoutes from './modules/assistant/assistant.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import billRoutes from './modules/bills/bills.routes.js';
import { BillsService } from './modules/bills/bills.service.js';
import customerRoutes from './modules/customers/customers.routes.js';
import itemRoutes from './modules/items/items.routes.js';
import { publicApiRoutes, publicPageRoutes } from './modules/public/public.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import storeRoutes from './modules/store/store.routes.js';
import summaryRoutes from './modules/summary/summary.routes.js';

export type AppConfig = Pick<
  Config,
  | 'JWT_ACCESS_SECRET'
  | 'ACCESS_TOKEN_TTL'
  | 'REFRESH_TOKEN_TTL_DAYS'
  | 'OTP_SECRET'
  | 'OTP_TTL_SECONDS'
  | 'OTP_DEV_ECHO'
  | 'PUBLIC_BASE_URL'
  | 'CORS_ORIGIN'
>;

export async function buildApp(
  config: AppConfig,
  db: Db,
  sender: MessageSender,
  fastifyOpts: FastifyServerOptions = {},
  { rateLimitEnabled = true } = {},
) {
  const app = Fastify({ trustProxy: true, bodyLimit: 1024 * 1024, ...fastifyOpts });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((o) => o.trim()),
    // @fastify/cors only allows GET, HEAD and POST by default; the API also uses PUT, PATCH and DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  if (rateLimitEnabled) await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin, { db, secret: config.JWT_ACCESS_SECRET, accessTokenTtl: config.ACCESS_TOKEN_TTL });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
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

  const authService = new AuthService(app, db, sender, {
    otpSecret: config.OTP_SECRET,
    otpTtlSeconds: config.OTP_TTL_SECONDS,
    otpDevEcho: config.OTP_DEV_ECHO,
    refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
  });
  const billsService = new BillsService(db, config.PUBLIC_BASE_URL);
  const publicBaseUrl = config.PUBLIC_BASE_URL;

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth', db, authService });
      await api.register(storeRoutes, { prefix: '/store', db });
      await api.register(itemRoutes, { prefix: '/items', db });
      await api.register(customerRoutes, { prefix: '/customers', db, publicBaseUrl });
      await api.register(billRoutes, { prefix: '/bills', db, billsService });
      await api.register(assistantRoutes, { prefix: '/assistant', db, billsService, publicBaseUrl });
      await api.register(summaryRoutes, { prefix: '/summary', db });
      await api.register(reportRoutes, { prefix: '/reports', db });
      await api.register(publicApiRoutes, { prefix: '/public', db });
    },
    { prefix: '/api/v1' },
  );
  await app.register(publicPageRoutes, { db });

  return app;
}
