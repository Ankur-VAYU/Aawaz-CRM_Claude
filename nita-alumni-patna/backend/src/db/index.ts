import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDb(connectionString: string, { max = 10 }: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];
