import { config } from '../config.js';
import { createDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';

const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);
await pool.end();
console.log('Migrations applied');
