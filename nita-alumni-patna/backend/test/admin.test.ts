import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_KEY, PDF, admin, setup, validJoin } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const csv = (url: string, body: string) =>
  t.app.inject({ method: 'POST', url, headers: { ...admin, 'content-type': 'text/csv' }, payload: body });

// Headers exactly as a Google Forms export of the join questions would produce them.
const GOOGLE_FORM_CSV = [
  'Timestamp,Full name (as on degree),Mobile number (WhatsApp),Email,Roll / enrolment number,Degree,Batch (passing year),Branch / department,Current position,Current organisation,Work city / district,Working state (or outside India),Home district,Open to mentoring',
  '2026/10/01 10:12:00,Rohit Kumar,98350 41276,rohit@example.com,08UCE021,B.Tech,2012,Civil Engineering,Executive Engineer,BRPNN,Patna,Bihar,Nalanda,yes',
  '2026/10/01 11:40:00,Rakesh Prasad,+91 99023 18475,,09ucs041,btech,2013,computer science and engineering,Senior Engineer,Flipkart,Bengaluru,karnataka,siwan,no',
  '2026/10/02 09:05:00,Wrong Person,12345,,,B.Tech,2030,Civil Engineering,,,,,Kolkata,',
  '2026/10/02 09:06:00,Copy Of Rohit,9835041276,,,B.Tech,2012,Civil Engineering,,,,,Patna,',
].join('\n');

describe('admin API access', () => {
  it('requires the admin key', async () => {
    expect((await t.app.inject('/api/v1/admin/members')).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/v1/admin/members', headers: { 'x-admin-key': 'wrong' } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/v1/admin/members', headers: { authorization: `Bearer ${ADMIN_KEY}` } })).statusCode).toBe(200);
  });
});

describe('creating accounts from the backend', () => {
  it('creates a verified account directly and records who did it', async () => {
    const res = await t.app.inject({
      method: 'POST', url: '/api/v1/admin/members', headers: admin,
      payload: { name: 'Amit Ranjan', phone: '9431120457', batch: 2008, branch: 'Electrical Engineering', degree: 'B.Tech', homeDistrict: 'Bhagalpur', role: 'admin', title: 'President' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'verified', role: 'admin' });
    const m = (await t.app.inject({ url: `/api/v1/admin/members/${res.json().id}`, headers: admin })).json();
    expect(m).toMatchObject({ source: 'admin', title: 'President', decidedBy: 'admin:Amit Ranjan' });
    const log = (await t.app.inject({ url: '/api/v1/admin/audit', headers: admin })).json();
    expect(log[0]).toMatchObject({ actor: 'admin:Amit Ranjan', action: 'member.created' });
  });

  it('imports a Google Forms export: dry run first, then for real, and skips repeats', async () => {
    const dry = (await csv('/api/v1/admin/members/import?dryRun=true', GOOGLE_FORM_CSV)).json();
    expect(dry).toMatchObject({ dryRun: true, total: 4, wouldCreate: 2, invalid: 2, created: 0 });
    expect(dry.ignoredColumns).toEqual(['Timestamp']);
    const bad = dry.rows.find((r: { row: number }) => r.row === 4);
    expect(bad.errors).toMatchObject({ phone: expect.any(String), homeDistrict: expect.stringMatching(/Bihar/), batch: expect.any(String) });
    expect(dry.rows.find((r: { row: number }) => r.row === 5).errors.phone).toBe('Same mobile number as row 2');
    expect((await t.app.inject({ url: '/api/v1/admin/members', headers: admin })).json()).toHaveLength(0);

    const real = (await csv('/api/v1/admin/members/import', GOOGLE_FORM_CSV)).json();
    expect(real).toMatchObject({ created: 2, invalid: 2 });
    const list = (await t.app.inject({ url: '/api/v1/admin/members?status=verified', headers: admin })).json();
    const rakesh = list.find((m: { name: string }) => m.name === 'Rakesh Prasad');
    expect(rakesh).toMatchObject({ phone: '+919902318475', rollNo: '09UCS041', degree: 'B.Tech', branch: 'Computer Science & Engineering', workState: 'Karnataka', homeDistrict: 'Siwan', source: 'import' });

    const again = (await csv('/api/v1/admin/members/import', GOOGLE_FORM_CSV)).json();
    expect(again).toMatchObject({ created: 0, alreadyRegistered: 2 });
  });

  it('explains missing columns instead of importing half a file', async () => {
    const res = await csv('/api/v1/admin/members/import', 'name,phone\nA,9876543210\n');
    expect(res.statusCode).toBe(400);
    expect(res.json().missingColumns).toEqual(['degree', 'branch', 'batch', 'homeDistrict']);
  });

  it('exports members in a format the importer accepts', async () => {
    await csv('/api/v1/admin/members/import', GOOGLE_FORM_CSV);
    const exp = await t.app.inject({ url: '/api/v1/admin/members.csv', headers: admin });
    expect(exp.headers['content-type']).toContain('text/csv');
    await t.reset();
    const re = (await csv('/api/v1/admin/members/import', exp.body)).json();
    expect(re).toMatchObject({ created: 2, invalid: 0 });
  });
});

describe('reviewing registrations', () => {
  it('approves, rejects with a reason, and manages roles', async () => {
    const a = (await t.app.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ proof: { name: 'degree.pdf', data: PDF } }) })).json();
    const b = (await t.app.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ phone: '8102349076', rollNo: '19UEI027', name: 'Ritika Raj' }) })).json();

    expect((await t.app.inject({ url: '/api/v1/admin/members?status=pending', headers: admin })).json()).toHaveLength(2);

    const roleBefore = await t.app.inject({ method: 'POST', url: `/api/v1/admin/members/${a.id}/role`, headers: admin, payload: { role: 'moderator' } });
    expect(roleBefore.statusCode).toBe(400);

    const approved = (await t.app.inject({ method: 'POST', url: `/api/v1/admin/members/${a.id}/approve`, headers: admin })).json();
    expect(approved).toMatchObject({ status: 'verified', decidedBy: 'admin:Amit Ranjan' });
    // The proof is deleted once decided; its file name stays as a record.
    expect(approved).toMatchObject({ hasProof: false, proofName: 'degree.pdf' });
    expect((await t.app.inject({ url: `/api/v1/admin/members/${a.id}/proof`, headers: admin })).statusCode).toBe(404);

    const noReason = await t.app.inject({ method: 'POST', url: `/api/v1/admin/members/${b.id}/reject`, headers: admin, payload: {} });
    expect(noReason.statusCode).toBe(400);
    const rejected = (await t.app.inject({ method: 'POST', url: `/api/v1/admin/members/${b.id}/reject`, headers: admin, payload: { reason: 'Roll number not found in batch records' } })).json();
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Roll number not found in batch records' });

    const mod = (await t.app.inject({ method: 'POST', url: `/api/v1/admin/members/${a.id}/role`, headers: admin, payload: { role: 'moderator', title: 'secretary' } })).json();
    expect(mod).toMatchObject({ role: 'moderator', title: 'Secretary' });

    const actions = (await t.app.inject({ url: '/api/v1/admin/audit', headers: admin })).json().map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['member.registered', 'member.approved', 'member.rejected', 'member.role_changed']));
  });

  it('re-checks pending registrations when the batch list is uploaded later', async () => {
    const { id } = (await t.app.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin() })).json();
    const before = (await t.app.inject({ url: `/api/v1/admin/members/${id}`, headers: admin })).json();
    expect(before.batchMatch).toBe('none');
    const up = (await csv('/api/v1/admin/batch-list', 'Roll Number,Student Name,Year of passing,Department,Programme\n19PCS011,Kumar Gaurav,2021,Computer Science & Engineering,M.Tech\nBAD1,Someone,2020,Unknown branch,B.Tech\n')).json();
    expect(up).toMatchObject({ upserted: 1, rematchedPending: 1 });
    expect(up.skipped[0].reason).toMatch(/branch/i);
    const after = (await t.app.inject({ url: `/api/v1/admin/members/${id}`, headers: admin })).json();
    expect(after.batchMatch).toBe('full');
  });
});
