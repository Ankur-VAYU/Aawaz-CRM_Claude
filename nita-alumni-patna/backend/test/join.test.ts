import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JPEG, PDF, admin, setup, validJoin } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const join = (payload: unknown) => t.app.inject({ method: 'POST', url: '/api/v1/join', payload: payload as object });

describe('join form page', () => {
  it('serves the form with the reference lists filled in and a strict CSP', async () => {
    const res = await t.app.inject('/join');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<option value="West Champaran">');
    expect(res.body).toContain('<option value="Outside India">');
    expect(res.body).not.toContain('{{');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await t.app.inject('/join.js')).statusCode).toBe(200);
    expect((await t.app.inject('/')).headers.location).toBe('/join');
  });
});

describe('POST /api/v1/join', () => {
  it('stores a pending registration with photo and proof, matched against the batch list', async () => {
    await t.app.inject({
      method: 'POST', url: '/api/v1/admin/batch-list', headers: { ...admin, 'content-type': 'text/csv' },
      payload: 'roll,name,batch,branch,degree\n19PCS011,Kumar Gaurav,2021,Computer Science & Engineering,M.Tech\n',
    });
    const res = await join(validJoin({ photo: JPEG, proof: { name: 'degree.pdf', data: PDF } }));
    expect(res.statusCode).toBe(201);
    const { id, status } = res.json();
    expect(status).toBe('pending');

    const m = (await t.app.inject({ url: `/api/v1/admin/members/${id}`, headers: admin })).json();
    expect(m).toMatchObject({
      phone: '+919031066284', rollNo: '19PCS011', homeState: 'Bihar', source: 'form', batchMatch: 'full',
      hasPhoto: true, hasProof: true, proofName: 'degree.pdf', emailVisibility: 'batch',
    });
    expect(m.consentAt).toBeTruthy();
    const photo = await t.app.inject({ url: `/api/v1/admin/members/${id}/photo`, headers: admin });
    expect(photo.headers['content-type']).toBe('image/jpeg');
  });

  it('reports what differs on a partial batch-list match', async () => {
    await t.app.inject({
      method: 'POST', url: '/api/v1/admin/batch-list', headers: { ...admin, 'content-type': 'text/csv' },
      payload: 'roll,name,batch,branch,degree\n19PCS011,Kumar Gaurav Singh,2021,Computer Science & Engineering,M.Tech\n',
    });
    const { id } = (await join(validJoin())).json();
    const m = (await t.app.inject({ url: `/api/v1/admin/members/${id}`, headers: admin })).json();
    expect(m.batchMatch).toBe('partial');
    expect(m.batchMatchNotes).toContain('name in list: Kumar Gaurav Singh');
  });

  it('accepts only home districts in Bihar and explains each problem per field', async () => {
    const res = await join(validJoin({ homeDistrict: 'Kolkata', phone: '12345', consent: false, batch: '2099' }));
    expect(res.statusCode).toBe(400);
    const { fields } = res.json();
    expect(fields.homeDistrict).toMatch(/Bihar/);
    expect(fields.phone).toMatch(/mobile/);
    expect(fields.consent).toBeDefined();
    expect(fields.batch).toMatch(/future/);
  });

  it('refuses a second registration with the same mobile or roll number', async () => {
    expect((await join(validJoin())).statusCode).toBe(201);
    const samePhone = await join(validJoin({ rollNo: 'X1' }));
    expect(samePhone.statusCode).toBe(409);
    expect(samePhone.json().error).toBe('DUPLICATE_PHONE');
    const sameRoll = await join(validJoin({ phone: '9876543210' }));
    expect(sameRoll.json().error).toBe('DUPLICATE_ROLL');
  });

  it('rejects files that are not what they claim to be, and bot submissions', async () => {
    const fake = `data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    expect((await join(validJoin({ photo: fake }))).json().fields.photo).toMatch(/not a valid JPEG/);
    expect((await join(validJoin({ proof: { name: 'x.exe', data: 'data:application/x-msdownload;base64,TVo=' } }))).json().fields.proof).toBeDefined();
    expect((await join(validJoin({ website: 'http://spam.example' }))).statusCode).toBe(400);
  });
});
