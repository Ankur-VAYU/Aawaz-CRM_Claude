import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDb(connectionString: string, opts: { max?: number } = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // No request should hang on a stuck query or a forgotten open transaction.
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  // An idle connection dropped by the database must not crash the server; the pool replaces it.
  pool.on('error', (err) => console.error('PostgreSQL pool error', err.message));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];
