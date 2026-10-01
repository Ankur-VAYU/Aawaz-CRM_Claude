import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { createDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../lib/password.js';
import { email, name, password } from '../modules/auth/auth.schemas.js';

const input = z
  .object({ ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: name.default('Aawaz Admin') })
  .parse(process.env);

const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);

const [existing] = await db.select().from(users).where(eq(users.email, input.ADMIN_EMAIL)).limit(1);
if (existing) {
  console.log(`User ${input.ADMIN_EMAIL} already exists (role: ${existing.role}); nothing to do.`);
} else {
  await db.insert(users).values({
    email: input.ADMIN_EMAIL,
    name: input.ADMIN_NAME,
    passwordHash: await hashPassword(input.ADMIN_PASSWORD),
    role: 'admin',
  });
  console.log(`Admin ${input.ADMIN_EMAIL} created.`);
}
await pool.end();
