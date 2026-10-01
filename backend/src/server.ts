import { buildApp } from './app.js';
import { config } from './config.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';

const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);

const app = await buildApp(config, db, {
  logger: config.NODE_ENV === 'development' ? { level: 'info' } : { level: 'warn' },
});

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
