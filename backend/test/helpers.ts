import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/aawaz_test';

export async function setupTestApp(overrides: { ALLOW_PUBLIC_SIGNUP?: boolean; ACCESS_TOKEN_TTL?: string } = {}) {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await runMigrations(db);
  const app = await buildApp(
    {
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
      ACCESS_TOKEN_TTL: overrides.ACCESS_TOKEN_TTL ?? '15m',
      REFRESH_TOKEN_TTL_DAYS: 30,
      CORS_ORIGIN: '*',
      ALLOW_PUBLIC_SIGNUP: overrides.ALLOW_PUBLIC_SIGNUP ?? true,
    },
    db,
    { logger: false },
    { rateLimitEnabled: false },
  );
  await app.ready();

  return {
    app,
    db,
    async reset() {
      await db.execute(sql`truncate table refresh_tokens, users cascade`);
    },
    async close() {
      await app.close();
      await pool.end();
    },
    async createUser(role: 'admin' | 'manager' | 'agent', email = `${role}@test.dev`, password = 'Password1') {
      const [user] = await db
        .insert(users)
        .values({ email, name: `${role} user`, role, passwordHash: await hashPassword(password) })
        .returning();
      return user;
    },
    async login(email: string, password = 'Password1') {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
      return res.json() as { accessToken: string; refreshToken: string; user: { id: string } };
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
