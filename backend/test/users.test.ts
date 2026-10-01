import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, setupTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let adminToken: string;
let adminId: string;

beforeAll(async () => {
  t = await setupTestApp();
});
beforeEach(async () => {
  await t.reset();
  const admin = await t.createUser('admin');
  adminId = admin.id;
  adminToken = (await t.login(admin.email)).accessToken;
});
afterAll(async () => {
  await t.close();
});

describe('access control', () => {
  it('agents cannot list or create users; managers can list but not create', async () => {
    await t.createUser('agent');
    await t.createUser('manager');
    const agent = await t.login('agent@test.dev');
    const manager = await t.login('manager@test.dev');

    expect((await t.app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(agent.accessToken) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(manager.accessToken) })).statusCode).toBe(200);
    const create = await t.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: bearer(manager.accessToken),
      payload: { name: 'N', email: 'n@test.dev', password: 'Password1' },
    });
    expect(create.statusCode).toBe(403);
  });

  it('role changes take effect immediately, without waiting for the token to expire', async () => {
    const mgr = await t.createUser('manager');
    const { accessToken } = await t.login(mgr.email);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${mgr.id}`,
      headers: bearer(adminToken),
      payload: { role: 'agent' },
    });
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/users', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(403);
  });
});

describe('admin user management', () => {
  it('creates, fetches, and updates a user', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: bearer(adminToken),
      payload: { name: 'Ravi', email: 'ravi@test.dev', password: 'Password1', role: 'manager' },
    });
    expect(created.statusCode).toBe(201);
    const { user } = created.json();
    expect(user).toMatchObject({ email: 'ravi@test.dev', role: 'manager' });

    const got = await t.app.inject({ method: 'GET', url: `/api/v1/users/${user.id}`, headers: bearer(adminToken) });
    expect(got.json().user.id).toBe(user.id);

    const upd = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${user.id}`,
      headers: bearer(adminToken),
      payload: { name: 'Ravi K', phone: null },
    });
    expect(upd.json().user.name).toBe('Ravi K');
  });

  it('returns 404 for unknown ids and 400 for malformed ids', async () => {
    const missing = await t.app.inject({
      method: 'GET',
      url: '/api/v1/users/00000000-0000-4000-8000-000000000000',
      headers: bearer(adminToken),
    });
    expect(missing.statusCode).toBe(404);
    const bad = await t.app.inject({ method: 'GET', url: '/api/v1/users/abc', headers: bearer(adminToken) });
    expect(bad.statusCode).toBe(400);
  });

  it('lists with pagination, search and filters', async () => {
    for (let i = 0; i < 5; i++) await t.createUser('agent', `agent${i}@test.dev`);
    await t.createUser('manager', 'boss_x@test.dev');

    const page = await t.app.inject({
      method: 'GET',
      url: '/api/v1/users?limit=2&page=2',
      headers: bearer(adminToken),
    });
    expect(page.json().data).toHaveLength(2);
    expect(page.json().pagination).toEqual({ page: 2, limit: 2, total: 7, totalPages: 4 });

    const byRole = await t.app.inject({ method: 'GET', url: '/api/v1/users?role=agent', headers: bearer(adminToken) });
    expect(byRole.json().pagination.total).toBe(5);

    const search = await t.app.inject({ method: 'GET', url: '/api/v1/users?search=agent3', headers: bearer(adminToken) });
    expect(search.json().data.map((u: { email: string }) => u.email)).toEqual(['agent3@test.dev']);

    // "_" is matched literally, not as a LIKE wildcard.
    const literal = await t.app.inject({ method: 'GET', url: '/api/v1/users?search=s_x', headers: bearer(adminToken) });
    expect(literal.json().data.map((u: { email: string }) => u.email)).toEqual(['boss_x@test.dev']);
  });

  it('deactivating a user revokes their sessions and blocks their access token', async () => {
    const agent = await t.createUser('agent');
    const session = await t.login(agent.email);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${agent.id}`,
      headers: bearer(adminToken),
      payload: { isActive: false },
    });
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(session.accessToken) });
    expect(me.statusCode).toBe(401);
    const refresh = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('admins cannot deactivate or demote themselves', async () => {
    for (const payload of [{ isActive: false }, { role: 'agent' }]) {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${adminId}`,
        headers: bearer(adminToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('resets a password and signs the user out', async () => {
    const agent = await t.createUser('agent');
    const session = await t.login(agent.email);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/users/${agent.id}/reset-password`,
      headers: bearer(adminToken),
      payload: { newPassword: 'Fresh1234' },
    });
    expect(res.statusCode).toBe(204);
    const refresh = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
    await expect(t.login(agent.email, 'Fresh1234')).resolves.toBeDefined();
  });
});
