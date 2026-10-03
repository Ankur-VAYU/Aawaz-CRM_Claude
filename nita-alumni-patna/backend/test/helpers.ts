import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nita_test';
export const ADMIN_KEY = 'test-admin-key-test-admin-key-1234567890';
export const admin = { 'x-admin-key': ADMIN_KEY, 'x-admin-name': 'Amit Ranjan' };

export async function setup() {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await runMigrations(pool);
  const app = await buildApp(db, { adminKey: ADMIN_KEY, rateLimit: false });
  await app.ready();
  const reset = () => db.execute(sql`TRUNCATE members, batch_records, audit_log RESTART IDENTITY`);
  const close = async () => {
    await app.close();
    await pool.end();
  };
  return { app, db, pool, reset, close };
}

// Smallest files whose first bytes identify them as JPEG and PDF.
export const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64')}`;
export const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%test\n').toString('base64')}`;

export const validJoin = (over: Record<string, unknown> = {}) => ({
  name: 'Kumar Gaurav',
  phone: '90310 66284',
  email: 'kumar.gaurav@example.com',
  rollNo: '19pcs011',
  degree: 'M.Tech',
  batch: '2021',
  branch: 'Computer Science & Engineering',
  position: 'Data Analyst',
  organisation: 'Bihar State Electronics Dev. Corp.',
  workDistrict: 'Patna',
  workState: 'Bihar',
  homeDistrict: 'Saran',
  linkedin: '',
  skills: 'SQL, Python',
  openToMentor: false,
  phoneVisibility: 'members',
  emailVisibility: 'batch',
  vouchedBy: 'Priya Sinha, 2015',
  consent: true,
  website: '',
  ...over,
});
