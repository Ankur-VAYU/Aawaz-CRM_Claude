import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizePhone, maskPhone } from '../src/lib/phone.js';
import { setupTestApp, type TestCtx } from './helpers.js';

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestApp();
});
beforeEach(async () => {
  await t.reset();
});
afterAll(async () => {
  await t.close();
});

describe('phone numbers', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['+14155552671', '+14155552671'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['12345', '5876543210', '+91123', 'abc'])('rejects %s', (input) => expect(normalizePhone(input)).toBeNull());

  it('masks like the design', () => expect(maskPhone('+919876543321')).toBe('98••• ••321'));
});

describe('OTP sign-in', () => {
  it('sends a code, verifies it, creates the account and reports no store yet', async () => {
    const req = await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '98765 43450' });
    expect(req.statusCode).toBe(200);
    const { devCode, expiresIn } = req.json();
    expect(devCode).toMatch(/^\d{6}$/);
    expect(expiresIn).toBe(300);
    expect(t.sender.sent).toHaveLength(1);
    expect(t.sender.sent[0]).toMatchObject({ to: '+919876543450', kind: 'otp' });
    expect(t.sender.sent[0].body).toContain(devCode);

    const res = await t.inject('POST', '/api/v1/auth/otp/verify', undefined, { phone: '+919876543450', code: devCode });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ isNewUser: true, store: null, tokenType: 'Bearer', user: { phone: '+919876543450' } });
    expect(body.accessToken).toBeTypeOf('string');

    const me = await t.inject('GET', '/api/v1/auth/me', body.accessToken);
    expect(me.json()).toMatchObject({ user: { phone: '+919876543450' }, store: null });
  });

  it('second sign-in is not a new user', async () => {
    await t.signIn();
    await t.db.execute(sql`update otp_codes set created_at = now() - interval '1 minute'`);
    const req = await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '9876543450' });
    const res = await t.inject('POST', '/api/v1/auth/otp/verify', undefined, { phone: '9876543450', code: req.json().devCode });
    expect(res.json().isNewUser).toBe(false);
  });

  it('rejects wrong codes, locks after 5 attempts, and codes are single-use', async () => {
    const { devCode } = (await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '9876543450' })).json();
    const wrong = devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await t.inject('POST', '/api/v1/auth/otp/verify', undefined, { phone: '9876543450', code: wrong });
      expect(r.statusCode).toBe(401);
    }
    const locked = await t.inject('POST', '/api/v1/auth/otp/verify', undefined, { phone: '9876543450', code: devCode });
    expect(locked.statusCode).toBe(429);
  });

  it('a code cannot be used twice', async () => {
    const { devCode } = (await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '9876543450' })).json();
    const first = await t.inject('POST', '/api/v1/auth/otp/verify', undefined, { phone: '9876543450', code: devCode });
    expect(first.statusCode).toBe(200);
    const again = await t.inject('POST', '/api/v1/auth/otp/verify', undefined, { phone: '9876543450', code: devCode });
    expect(again.statusCode).toBe(401);
  });

  it('throttles resends', async () => {
    await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '9876543450' });
    const again = await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '9876543450' });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('validates the phone number', async () => {
    const r = await t.inject('POST', '/api/v1/auth/otp/request', undefined, { phone: '12345' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and detects reuse', async () => {
    const first = await t.signIn();
    const r1 = await t.inject('POST', '/api/v1/auth/refresh', undefined, { refreshToken: first.refreshToken });
    expect(r1.statusCode).toBe(200);
    const second = r1.json();
    const reuse = await t.inject('POST', '/api/v1/auth/refresh', undefined, { refreshToken: first.refreshToken });
    expect(reuse.statusCode).toBe(401);
    const after = await t.inject('POST', '/api/v1/auth/refresh', undefined, { refreshToken: second.refreshToken });
    expect(after.statusCode).toBe(401);
  });

  it('logout ends the session', async () => {
    const s = await t.signIn();
    expect((await t.inject('POST', '/api/v1/auth/logout', s.accessToken, { refreshToken: s.refreshToken })).statusCode).toBe(204);
    expect((await t.inject('POST', '/api/v1/auth/refresh', undefined, { refreshToken: s.refreshToken })).statusCode).toBe(401);
  });

  it('protected routes need a token', async () => {
    expect((await t.inject('GET', '/api/v1/auth/me')).statusCode).toBe(401);
    expect((await t.inject('GET', '/api/v1/auth/me', 'garbage')).statusCode).toBe(401);
  });
});
