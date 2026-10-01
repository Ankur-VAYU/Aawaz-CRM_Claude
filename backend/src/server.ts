import { buildApp } from './app.js';
import { config } from './config.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { LogSender } from './messaging/sender.js';
import { startWorkers } from './messaging/workers.js';

const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);

let app: Awaited<ReturnType<typeof buildApp>>;
// Replace LogSender with a WhatsApp Business / SMS provider implementation for production.
const sender = new LogSender({ info: (obj: unknown, msg?: string) => app.log.info(obj, msg) });
app = await buildApp(config, db, sender, {
  logger: config.NODE_ENV === 'development' ? { level: 'info' } : { level: 'warn' },
});
if (config.NODE_ENV === 'production') {
  app.log.warn('Messages (OTP, receipts, summaries) are only logged: configure a real MessageSender');
}

const stopWorkers = config.RUN_WORKERS ? startWorkers(db, sender, app.log) : () => {};

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopWorkers();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
