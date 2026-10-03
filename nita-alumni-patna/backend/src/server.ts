import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(pool, (m) => console.log(m));

const app = await buildApp(db, {
  adminKey: config.ADMIN_API_KEY,
  trustProxy: config.TRUST_PROXY,
  fastify: { logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug' } },
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
