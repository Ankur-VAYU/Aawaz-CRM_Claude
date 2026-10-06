import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { MemorySender } from '../src/messaging/sender.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/aawaz_test';

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** The catalogue used across tests, matching the shop in the design. Prices in rupees. */
export const DESIGN_ITEMS = [
  { name: 'Atta', unit: 'kg', unitSize: 5, price: 245, stock: 24, stockLabel: 'bag', aliases: ['wheat flour', 'flour'] },
  { name: 'Toor dal', unit: 'kg', unitSize: 1, price: 160, stock: 12, aliases: ['arhar dal'] },
  { name: 'Sarson tel', unit: 'l', unitSize: 1, price: 170, stock: 10, aliases: ['mustard oil'] },
  { name: 'Sarson tel', unit: 'ml', unitSize: 500, price: 90, stock: 10, aliases: ['mustard oil'] },
  { name: 'Moong dal', unit: 'kg', unitSize: 1, price: 130, stock: 20 },
  { name: 'Maida', unit: 'kg', unitSize: 1, price: 45, stock: 20, aliases: ['refined flour'] },
  { name: 'Chawal', unit: 'kg', unitSize: 1, price: 60, stock: 50, aliases: ['rice'] },
  { name: 'Namak', unit: 'pc', unitSize: 1, price: 25, stock: 30, stockLabel: 'pc', aliases: ['salt'] },
  { name: 'Cheeni', unit: 'kg', unitSize: 1, price: 45, stock: 3, lowStockThreshold: 5, aliases: ['sugar'] },
];

export async function setupTestApp() {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await runMigrations(db);
  const sender = new MemorySender();
  const app = await buildApp(
    {
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL_DAYS: 30,
      OTP_SECRET: 'otp-secret-otp-secret-otp-secret-123456',
      OTP_TTL_SECONDS: 300,
      OTP_DEV_ECHO: true,
      PUBLIC_BASE_URL: 'https://aawaz.test',
      CORS_ORIGIN: '*',
    },
    db,
    sender,
    { logger: false },
    { rateLimitEnabled: false },
  );
  await app.ready();

  const inject = (method: string, url: string, token?: string, payload?: unknown) =>
    app.inject({ method: method as 'GET', url, headers: token ? bearer(token) : {}, payload: payload as object });

  const t = {
    app,
    db,
    sender,
    inject,
    async reset() {
      await db.execute(sql`truncate table users, otp_codes cascade`);
      sender.sent = [];
      sender.failNext = 0;
    },
    async close() {
      await app.close();
      await pool.end();
    },
    /** Full OTP sign-in. Returns tokens. */
    async signIn(phone = '9876543450') {
      const req = await inject('POST', '/api/v1/auth/otp/request', undefined, { phone });
      if (req.statusCode !== 200) throw new Error(`otp request failed: ${req.body}`);
      const res = await inject('POST', '/api/v1/auth/otp/verify', undefined, { phone, code: req.json().devCode });
      if (res.statusCode !== 200) throw new Error(`otp verify failed: ${res.body}`);
      return res.json() as { accessToken: string; refreshToken: string; user: { id: string; phone: string } };
    },
    /** Signs in, creates the design's shop and catalogue, and finishes onboarding. */
    async shop(phone = '9876543450', opts: { givesCredit?: boolean } = {}) {
      const { accessToken: token } = await t.signIn(phone);
      const ok = (r: { statusCode: number; body: string }, what: string) => {
        if (r.statusCode >= 300) throw new Error(`${what} failed: ${r.body}`);
      };
      ok(
        await inject('POST', '/api/v1/store', token, {
          name: 'Sharma Kirana Store',
          ownerName: 'Rajesh Sharma',
          city: 'Sitapur',
          state: 'Uttar Pradesh',
          givesCredit: opts.givesCredit ?? true,
        }),
        'store',
      );
      ok(await inject('PUT', '/api/v1/store/preferences', token, { language: 'hinglish', replyStyle: 'voice_text' }), 'prefs');
      ok(await inject('POST', '/api/v1/items/bulk', token, { items: DESIGN_ITEMS }), 'items');
      ok(await inject('POST', '/api/v1/store/onboarding/complete', token), 'complete');
      const items = (await inject('GET', '/api/v1/items', token)).json().data as { id: string; displayName: string; stock: number }[];
      const item = (displayName: string) => items.find((i) => i.displayName === displayName)!;
      return { token, items, item };
    },
    /** Customers with a phone number agree to messages unless `consent: false`. */
    async customer(token: string, name: string, phone?: string, extra: { consent?: boolean; gstin?: string } = {}) {
      const r = await inject('POST', '/api/v1/customers', token, {
        name,
        phone,
        gstin: extra.gstin,
        messagingConsent: extra.consent ?? Boolean(phone),
      });
      if (r.statusCode !== 201) throw new Error(`customer failed: ${r.body}`);
      return r.json().customer as { id: string; name: string };
    },
    async say(token: string, text: string, extra: Record<string, unknown> = {}) {
      const r = await inject('POST', '/api/v1/assistant/message', token, { text, ...extra });
      if (r.statusCode !== 200) throw new Error(`assistant failed: ${r.body}`);
      return r.json();
    },
  };
  return t;
}

export type TestCtx = Awaited<ReturnType<typeof setupTestApp>>;
