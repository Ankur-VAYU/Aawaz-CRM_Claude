/**
 * Creates the demo shop from the design (Sharma Kirana Store) for local development.
 * Sign in with phone 9876543450; with OTP_DEV_ECHO=true the code is returned by /auth/otp/request.
 */
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { createDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { customers, items, stores, users } from '../db/schema.js';
import { generateShareToken } from '../lib/tokens.js';

if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production');
  process.exit(1);
}

const PHONE = '+919876543450';
const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);

const [existing] = await db.select().from(users).where(eq(users.phone, PHONE));
if (existing) {
  console.log(`Demo user ${PHONE} already exists; nothing to do.`);
} else {
  await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ phone: PHONE, name: 'Rajesh Sharma' }).returning();
    const [store] = await tx
      .insert(stores)
      .values({
        ownerId: user.id,
        name: 'Sharma Kirana Store',
        ownerName: 'Rajesh Sharma',
        city: 'Sitapur',
        state: 'Uttar Pradesh',
        preferencesSetAt: new Date(),
        onboardedAt: new Date(),
      })
      .returning();
    const p = (rupees: number) => rupees * 100;
    await tx.insert(items).values(
      [
        { name: 'Atta', unit: 'kg', unitSize: 5, price: p(245), stock: 24, stockLabel: 'bag', aliases: ['wheat flour', 'flour'] },
        { name: 'Toor dal', unit: 'kg', unitSize: 1, price: p(160), stock: 12, aliases: ['arhar dal'] },
        { name: 'Sarson tel', unit: 'l', unitSize: 1, price: p(170), stock: 10, aliases: ['mustard oil'] },
        { name: 'Sarson tel', unit: 'ml', unitSize: 500, price: p(90), stock: 10, aliases: ['mustard oil'] },
        { name: 'Moong dal', unit: 'kg', unitSize: 1, price: p(130), stock: 20 },
        { name: 'Maida', unit: 'kg', unitSize: 1, price: p(45), stock: 20, aliases: ['refined flour'] },
        { name: 'Chawal', unit: 'kg', unitSize: 1, price: p(60), stock: 50, aliases: ['rice'] },
        { name: 'Namak', unit: 'pc', unitSize: 1, price: p(25), stock: 30, aliases: ['salt'] },
        { name: 'Cheeni', unit: 'kg', unitSize: 1, price: p(45), stock: 2, aliases: ['sugar'] },
      ].map((i) => ({ ...i, unit: i.unit as 'kg' | 'l' | 'ml' | 'pc', storeId: store.id })),
    );
    await tx.insert(customers).values(
      [
        { name: 'Ramesh Yadav', phone: '+919812345321' },
        { name: 'Sunita Devi', phone: '+919812345322' },
        { name: 'Mohd. Irfan', phone: null },
        { name: 'Kavita Sharma', phone: null },
        { name: 'Pappu Singh', phone: null },
      ].map((c) => ({ ...c, storeId: store.id, shareToken: generateShareToken() })),
    );
  });
  console.log(`Demo shop created. Sign in with ${PHONE}.`);
}
await pool.end();
