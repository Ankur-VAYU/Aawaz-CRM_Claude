import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, setupTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof setupTestApp>>;

beforeAll(async () => {
  t = await setupTestApp();
});
beforeEach(async () => {
  await t.reset();
});
afterAll(async () => {
  await t.close();
});

const register = (payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });

describe('health', () => {
  it('reports ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /auth/register', () => {
  it('creates an agent account and returns tokens without the password hash', async () => {
    const res = await register({ name: 'Asha', email: ' Asha@Example.com ', password: 'Secret123', phone: '+919876543210' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com', role: 'agent', isActive: true });
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    expect(body.tokenType).toBe('Bearer');
    expect(body.accessTokenExpiresIn).toBeGreaterThan(890);
  });

  it('ignores a role field so users cannot self-promote', async () => {
    const res = await register({ name: 'X', email: 'x@example.com', password: 'Secret123', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('agent');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    await register({ name: 'A', email: 'dup@example.com', password: 'Secret123' });
    const res = await register({ name: 'B', email: 'DUP@example.com', password: 'Secret123' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('validates input', async () => {
    const res = await register({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    const paths = error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('can be disabled', async () => {
    const closed = await setupTestApp({ ALLOW_PUBLIC_SIGNUP: false });
    const res = await closed.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'A', email: 'a@example.com', password: 'Secret123' },
    });
    expect(res.statusCode).toBe(403);
    await closed.close();
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials and records lastLoginAt', async () => {
    await t.createUser('agent', 'agent@test.dev');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'AGENT@test.dev', password: 'Password1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.lastLoginAt).not.toBeNull();
  });

  it('returns the same error for wrong password and unknown email', async () => {
    await t.createUser('agent', 'agent@test.dev');
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'agent@test.dev', password: 'Nope12345' },
    });
    const unknown = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ghost@test.dev', password: 'Nope12345' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('rejects deactivated users', async () => {
    const admin = await t.createUser('admin');
    const agent = await t.createUser('agent');
    const { accessToken } = await t.login(admin.email);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${agent.id}`,
      headers: bearer(accessToken),
      payload: { isActive: false },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: agent.email, password: 'Password1' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET/PATCH /auth/me', () => {
  it('requires a valid token', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const bad = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer('garbage') });
    expect(bad.statusCode).toBe(401);
  });

  it('rejects expired access tokens', async () => {
    const short = await setupTestApp({ ACCESS_TOKEN_TTL: '1s' });
    await short.createUser('agent');
    const { accessToken } = await short.login('agent@test.dev');
    await new Promise((r) => setTimeout(r, 2100));
    const res = await short.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(401);
    await short.close();
  });

  it('returns and updates the current user', async () => {
    await t.createUser('agent');
    const { accessToken } = await t.login('agent@test.dev');
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(accessToken) });
    expect(me.json().user.email).toBe('agent@test.dev');

    const upd = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken),
      payload: { name: 'New Name', phone: '9876543210', role: 'admin' },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().user).toMatchObject({ name: 'New Name', phone: '9876543210', role: 'agent' });
  });
});

describe('refresh tokens', () => {
  it('rotates tokens and detects reuse of an old token', async () => {
    await t.createUser('agent');
    const first = await t.login('agent@test.dev');

    const r1 = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(r1.statusCode).toBe(200);
    const second = r1.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Reusing the old token is treated as theft: it fails and kills the newer token too.
    const reuse = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: second.refreshToken },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('only one of two concurrent refreshes with the same token succeeds', async () => {
    await t.createUser('agent');
    const { refreshToken } = await t.login('agent@test.dev');
    const results = await Promise.all(
      [1, 2].map(() =>
        t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200).length).toBeLessThanOrEqual(1);
  });

  it('rejects unknown tokens', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout revokes only that session; logout-all revokes every session', async () => {
    await t.createUser('agent');
    const phone = await t.login('agent@test.dev');
    const tablet = await t.login('agent@test.dev');
    const laptop = await t.login('agent@test.dev');

    const out = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: bearer(phone.accessToken),
      payload: { refreshToken: phone.refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const refresh = (token: string) =>
      t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: token } });
    expect((await refresh(phone.refreshToken)).statusCode).toBe(401);
    const tabletNew = await refresh(tablet.refreshToken);
    expect(tabletNew.statusCode).toBe(200);

    await t.app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: bearer(laptop.accessToken) });
    expect((await refresh(laptop.refreshToken)).statusCode).toBe(401);
    expect((await refresh(tabletNew.json().refreshToken)).statusCode).toBe(401);
  });
});

describe('POST /auth/change-password', () => {
  it('requires the current password, then signs out other sessions', async () => {
    await t.createUser('agent');
    const other = await t.login('agent@test.dev');
    const current = await t.login('agent@test.dev');

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: bearer(current.accessToken),
      payload: { currentPassword: 'Wrong1234', newPassword: 'NewPass123' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: bearer(current.accessToken),
      payload: { currentPassword: 'Password1', newPassword: 'NewPass123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().refreshToken).toBeTypeOf('string');

    const oldRefresh = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: other.refreshToken },
    });
    expect(oldRefresh.statusCode).toBe(401);
    await expect(t.login('agent@test.dev', 'Password1')).rejects.toThrow();
    await expect(t.login('agent@test.dev', 'NewPass123')).resolves.toBeDefined();
  });
});
