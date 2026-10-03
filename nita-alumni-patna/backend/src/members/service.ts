import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import type { Db } from '../db/index.js';
import { auditLog, batchRecords, members, type Member, type NewMember } from '../db/schema.js';
import { badRequest, conflict, notFound, uniqueViolation } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { BRANCHES, DEGREES, matchOption } from '../lib/reference.js';
import { parseBatchCsv, parseMemberCsv } from './csv.js';
import { adminCreateInput, fieldErrors, type AdminCreateInput, type JoinInput, type MemberFields } from './schemas.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/* ---------- batch list matching ---------- */

const normName = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

export interface BatchMatch {
  level: 'full' | 'partial' | 'none';
  notes: string | null;
}

/** Compares a member's roll number, name, batch, branch and degree with the institute batch list. */
export async function matchBatchList(
  db: Conn,
  m: { rollNo?: string | null; name: string; batch: number; branch: string; degree: string },
): Promise<BatchMatch> {
  if (!m.rollNo) return { level: 'none', notes: 'No roll number given' };
  const [rec] = await db.select().from(batchRecords).where(eq(batchRecords.rollNo, m.rollNo));
  if (!rec) return { level: 'none', notes: `Roll number ${m.rollNo} is not in the batch list` };
  const diffs: string[] = [];
  if (normName(rec.name) !== normName(m.name)) diffs.push(`name in list: ${rec.name}`);
  if (rec.batch !== m.batch) diffs.push(`batch in list: ${rec.batch}`);
  if (rec.branch !== m.branch) diffs.push(`branch in list: ${rec.branch}`);
  if (rec.degree !== m.degree) diffs.push(`degree in list: ${rec.degree}`);
  return diffs.length ? { level: 'partial', notes: diffs.join('; ') } : { level: 'full', notes: null };
}

/* ---------- audit ---------- */

async function audit(db: Conn, actor: string, action: string, target: string | null, detail?: unknown) {
  await db.insert(auditLog).values({ actor, action, target, detail: detail ?? null });
}

/* ---------- create ---------- */

export interface CreateOptions {
  source: 'form' | 'import' | 'admin';
  status: 'pending' | 'verified';
  role?: 'member' | 'moderator' | 'admin';
  title?: string | null;
  actor: string;
  photo?: { type: string; data: Buffer };
  proof?: { name: string; type: string; data: Buffer };
  consent?: boolean;
}

function fieldsToRow(f: MemberFields): Omit<NewMember, 'source'> {
  return {
    name: f.name,
    phone: f.phone,
    email: f.email ?? null,
    rollNo: f.rollNo ?? null,
    degree: f.degree,
    branch: f.branch,
    batch: f.batch,
    position: f.position ?? null,
    organisation: f.organisation ?? null,
    homeDistrict: f.homeDistrict,
    homeState: 'Bihar',
    workDistrict: f.workDistrict ?? null,
    workState: f.workState ?? null,
    linkedin: f.linkedin ?? null,
    skills: f.skills ?? null,
    openToMentor: f.openToMentor,
    phoneVisibility: f.phoneVisibility,
    emailVisibility: f.emailVisibility,
    vouchedBy: f.vouchedBy ?? null,
  };
}

function duplicateError(constraint: string) {
  if (constraint === 'members_phone_key')
    return conflict('This mobile number is already registered. If this is you, contact a chapter admin.', 'DUPLICATE_PHONE');
  if (constraint === 'members_roll_no_key')
    return conflict('This roll number is already registered. If this is you, contact a chapter admin.', 'DUPLICATE_ROLL');
  return conflict('This member already exists.');
}

/** Creates one member. Used by the join form, admin API, command line and CSV import. */
export async function createMember(db: Db, f: MemberFields, opts: CreateOptions) {
  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      const match = await matchBatchList(tx, f);
      const [row] = await tx
        .insert(members)
        .values({
          ...fieldsToRow(f),
          source: opts.source,
          status: opts.status,
          role: opts.role ?? 'member',
          title: opts.title ?? null,
          batchMatch: match.level,
          batchMatchNotes: match.notes,
          photo: opts.photo?.data ?? null,
          photoType: opts.photo?.type ?? null,
          proof: opts.proof?.data ?? null,
          proofType: opts.proof?.type ?? null,
          proofName: opts.proof?.name ?? null,
          consentAt: opts.consent ? now : null,
          decidedBy: opts.status === 'verified' ? opts.actor : null,
          decidedAt: opts.status === 'verified' ? now : null,
        })
        .returning({ id: members.id, name: members.name, phone: members.phone, status: members.status, role: members.role, batchMatch: members.batchMatch });
      await audit(tx, opts.actor, opts.source === 'form' ? 'member.registered' : 'member.created', row.id, {
        name: row.name, source: opts.source, status: row.status, role: row.role, batchMatch: match.level,
      });
      return row;
    });
  } catch (err) {
    const c = uniqueViolation(err);
    if (c !== null) throw duplicateError(c);
    throw err;
  }
}

export function registerFromForm(db: Db, input: JoinInput) {
  const { photo, proof, consent, website: _website, ...fields } = input;
  return createMember(db, fields, {
    source: 'form',
    status: 'pending',
    actor: 'join-form',
    photo,
    proof: proof ? { name: proof.name, type: proof.data.type, data: proof.data.data } : undefined,
    consent,
  });
}

export function createByAdmin(db: Db, input: AdminCreateInput, actor: string) {
  const { status, role, title, ...fields } = input;
  return createMember(db, fields, { source: 'admin', status, role, title: title ?? null, actor });
}

/* ---------- bulk import ---------- */

export interface ImportRowResult {
  row: number;
  name: string;
  phone: string;
  result: 'created' | 'would_create' | 'already_registered' | 'invalid';
  errors?: Record<string, string>;
}

export interface ImportSummary {
  dryRun: boolean;
  status: 'pending' | 'verified';
  total: number;
  created: number;
  wouldCreate: number;
  alreadyRegistered: number;
  invalid: number;
  ignoredColumns: string[];
  rows: ImportRowResult[];
}

/**
 * Imports members from CSV (for example a Google Forms or Excel export).
 * Valid rows are created; invalid or already-registered rows are reported and skipped, so a
 * corrected file can be imported again safely. With dryRun nothing is written.
 */
export async function importMembers(
  db: Db,
  csvText: string,
  opts: { dryRun: boolean; status: 'pending' | 'verified'; actor: string },
): Promise<ImportSummary> {
  let parsed;
  try {
    parsed = parseMemberCsv(csvText);
  } catch (err) {
    throw badRequest(`Could not read the CSV file: ${(err as Error).message}`);
  }
  if (!parsed.rows.length) throw badRequest('The file has no data rows');
  if (parsed.missingColumns.length) throw badRequest(`Missing required columns: ${parsed.missingColumns.join(', ')}`, { missingColumns: parsed.missingColumns });

  const results: ImportRowResult[] = [];
  const valid: { row: number; input: AdminCreateInput }[] = [];
  const seenPhones = new Map<string, number>();
  const seenRolls = new Map<string, number>();

  parsed.rows.forEach((raw, i) => {
    const row = i + 2; // +1 for the header, +1 because spreadsheets count from 1
    const res = adminCreateInput.safeParse({ ...raw, status: raw.status || opts.status });
    if (!res.success) {
      results.push({ row, name: raw.name ?? '', phone: raw.phone ?? '', result: 'invalid', errors: fieldErrors(res.error) });
      return;
    }
    const d = res.data;
    const dupPhone = seenPhones.get(d.phone);
    const dupRoll = d.rollNo ? seenRolls.get(d.rollNo) : undefined;
    if (dupPhone || dupRoll) {
      results.push({
        row, name: d.name, phone: d.phone, result: 'invalid',
        errors: dupPhone ? { phone: `Same mobile number as row ${dupPhone}` } : { rollNo: `Same roll number as row ${dupRoll}` },
      });
      return;
    }
    seenPhones.set(d.phone, row);
    if (d.rollNo) seenRolls.set(d.rollNo, row);
    valid.push({ row, input: d });
  });

  // Rows whose phone or roll number is already in the database are skipped, not errors.
  const phones = valid.map((v) => v.input.phone);
  const rolls = valid.map((v) => v.input.rollNo).filter((r): r is string => !!r);
  const existing = phones.length
    ? await db
        .select({ phone: members.phone, rollNo: members.rollNo })
        .from(members)
        .where(rolls.length ? or(inArray(members.phone, phones), inArray(members.rollNo, rolls)) : inArray(members.phone, phones))
    : [];
  const existingPhones = new Set(existing.map((e) => e.phone));
  const existingRolls = new Set(existing.map((e) => e.rollNo).filter(Boolean));

  for (const { row, input } of valid) {
    if (existingPhones.has(input.phone) || (input.rollNo && existingRolls.has(input.rollNo))) {
      results.push({ row, name: input.name, phone: input.phone, result: 'already_registered' });
      continue;
    }
    if (opts.dryRun) {
      results.push({ row, name: input.name, phone: input.phone, result: 'would_create' });
      continue;
    }
    try {
      const { status, role, title, ...fields } = input;
      await createMember(db, fields, { source: 'import', status, role, title: title ?? null, actor: opts.actor });
      results.push({ row, name: input.name, phone: input.phone, result: 'created' });
    } catch (err) {
      const e = err as { statusCode?: number; message: string };
      if (e.statusCode === 409) results.push({ row, name: input.name, phone: input.phone, result: 'already_registered' });
      else throw err;
    }
  }

  results.sort((a, b) => a.row - b.row);
  const count = (r: ImportRowResult['result']) => results.filter((x) => x.result === r).length;
  const summary: ImportSummary = {
    dryRun: opts.dryRun,
    status: opts.status,
    total: parsed.rows.length,
    created: count('created'),
    wouldCreate: count('would_create'),
    alreadyRegistered: count('already_registered'),
    invalid: count('invalid'),
    ignoredColumns: parsed.ignoredColumns,
    rows: results,
  };
  if (!opts.dryRun) {
    await audit(db, opts.actor, 'members.imported', null, {
      total: summary.total, created: summary.created, alreadyRegistered: summary.alreadyRegistered, invalid: summary.invalid,
    });
  }
  return summary;
}

/* ---------- batch list ---------- */

export async function importBatchList(db: Db, csvText: string, actor: string) {
  let parsed;
  try {
    parsed = parseBatchCsv(csvText);
  } catch (err) {
    throw badRequest(`Could not read the CSV file: ${(err as Error).message}`);
  }
  if (!parsed.rows.length) throw badRequest('The file has no data rows');
  if (parsed.missingColumns.length) throw badRequest(`Missing required columns: ${parsed.missingColumns.join(', ')}`);

  const skipped: { row: number; reason: string }[] = [];
  const records: (typeof batchRecords.$inferInsert)[] = [];
  parsed.rows.forEach((r, i) => {
    const row = i + 2;
    const batch = Number(r.batch);
    const branch = matchOption(BRANCHES, r.branch ?? '');
    const degree = matchOption(DEGREES, r.degree ?? '');
    const rollNo = (r.rollNo ?? '').trim().toUpperCase();
    if (!rollNo || !r.name) return skipped.push({ row, reason: 'Roll number and name are required' });
    if (!Number.isInteger(batch)) return skipped.push({ row, reason: `Batch "${r.batch}" is not a year` });
    if (!branch) return skipped.push({ row, reason: `Branch "${r.branch}" is not in the branch list` });
    if (!degree) return skipped.push({ row, reason: `Degree "${r.degree}" is not in the degree list` });
    records.push({ rollNo, name: r.name.trim(), batch, branch, degree });
  });

  let upserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    await db
      .insert(batchRecords)
      .values(chunk)
      .onConflictDoUpdate({
        target: batchRecords.rollNo,
        set: { name: sql`excluded.name`, batch: sql`excluded.batch`, branch: sql`excluded.branch`, degree: sql`excluded.degree`, uploadedAt: sql`now()` },
      });
    upserted += chunk.length;
  }
  const rematched = await rematchPending(db);
  await audit(db, actor, 'batch_list.uploaded', null, { upserted, skipped: skipped.length });
  return { upserted, skipped, rematchedPending: rematched };
}

/** Re-checks every pending member after the batch list changes. */
async function rematchPending(db: Db) {
  const pending = await db
    .select({ id: members.id, rollNo: members.rollNo, name: members.name, batch: members.batch, branch: members.branch, degree: members.degree })
    .from(members)
    .where(eq(members.status, 'pending'));
  for (const p of pending) {
    const m = await matchBatchList(db, p);
    await db.update(members).set({ batchMatch: m.level, batchMatchNotes: m.notes }).where(eq(members.id, p.id));
  }
  return pending.length;
}

/* ---------- review and roles ---------- */

const PUBLIC_COLUMNS = {
  id: members.id, name: members.name, phone: members.phone, email: members.email, rollNo: members.rollNo,
  degree: members.degree, branch: members.branch, batch: members.batch, position: members.position,
  organisation: members.organisation, homeDistrict: members.homeDistrict, homeState: members.homeState,
  workDistrict: members.workDistrict, workState: members.workState, linkedin: members.linkedin, skills: members.skills,
  openToMentor: members.openToMentor, phoneVisibility: members.phoneVisibility, emailVisibility: members.emailVisibility,
  vouchedBy: members.vouchedBy, status: members.status, role: members.role, title: members.title, source: members.source,
  batchMatch: members.batchMatch, batchMatchNotes: members.batchMatchNotes, rejectReason: members.rejectReason,
  decidedBy: members.decidedBy, decidedAt: members.decidedAt, consentAt: members.consentAt,
  hasPhoto: sql<boolean>`${members.photo} IS NOT NULL`, proofName: members.proofName,
  hasProof: sql<boolean>`${members.proof} IS NOT NULL`, createdAt: members.createdAt, updatedAt: members.updatedAt,
};

export async function getMember(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Member not found');
  const [m] = await db.select(PUBLIC_COLUMNS).from(members).where(eq(members.id, id));
  if (!m) throw notFound('Member not found');
  return m;
}

/** Finds a member by id, mobile number or roll number (for the command line). */
export async function findMember(db: Db, key: string) {
  if (/^[0-9a-f-]{36}$/i.test(key)) return getMember(db, key);
  const phone = normalizePhone(key);
  const [m] = await db
    .select(PUBLIC_COLUMNS)
    .from(members)
    .where(phone ? eq(members.phone, phone) : eq(members.rollNo, key.toUpperCase()));
  if (!m) throw notFound(`No member with mobile number or roll number ${key}`);
  return m;
}

export async function listMembers(db: Db, f: { status?: Member['status']; q?: string; limit?: number; offset?: number }) {
  const where: SQL[] = [];
  if (f.status) where.push(eq(members.status, f.status));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, '\\$&')}%`;
    where.push(or(ilike(members.name, like), ilike(members.phone, like), ilike(members.rollNo, like), ilike(members.organisation, like))!);
  }
  return db
    .select(PUBLIC_COLUMNS)
    .from(members)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(members.createdAt))
    .limit(Math.min(f.limit ?? 100, 500))
    .offset(f.offset ?? 0);
}

export async function getFile(db: Db, id: string, kind: 'photo' | 'proof') {
  await getMember(db, id);
  const [row] = await db
    .select(kind === 'photo' ? { data: members.photo, type: members.photoType } : { data: members.proof, type: members.proofType })
    .from(members)
    .where(eq(members.id, id));
  if (!row?.data || !row.type) throw notFound(kind === 'photo' ? 'No photo uploaded' : 'No proof document uploaded');
  return { data: row.data, type: row.type };
}

export async function approveMember(db: Db, id: string, actor: string) {
  const m = await getMember(db, id);
  if (m.status === 'verified') return m;
  await db.update(members).set({ status: 'verified', rejectReason: null, decidedBy: actor, decidedAt: new Date(), updatedAt: new Date() }).where(eq(members.id, id));
  await audit(db, actor, 'member.approved', id, { name: m.name, batchMatch: m.batchMatch });
  return getMember(db, id);
}

export async function rejectMember(db: Db, id: string, reason: string, actor: string) {
  const m = await getMember(db, id);
  await db.update(members).set({ status: 'rejected', rejectReason: reason, decidedBy: actor, decidedAt: new Date(), updatedAt: new Date() }).where(eq(members.id, id));
  await audit(db, actor, 'member.rejected', id, { name: m.name, reason });
  return getMember(db, id);
}

export async function setStatus(db: Db, id: string, status: 'verified' | 'suspended', actor: string) {
  const m = await getMember(db, id);
  await db.update(members).set({ status, updatedAt: new Date() }).where(eq(members.id, id));
  await audit(db, actor, status === 'suspended' ? 'member.suspended' : 'member.reinstated', id, { name: m.name });
  return getMember(db, id);
}

export async function setRole(db: Db, id: string, role: Member['role'], title: string | null | undefined, actor: string) {
  const m = await getMember(db, id);
  if (role !== 'member' && m.status !== 'verified') throw badRequest('Only verified members can be moderators or admins');
  const newTitle = role === 'member' ? null : title === undefined ? m.title : title;
  await db.update(members).set({ role, title: newTitle, updatedAt: new Date() }).where(eq(members.id, id));
  await audit(db, actor, 'member.role_changed', id, { name: m.name, from: m.role, to: role, title: newTitle });
  return getMember(db, id);
}

export async function listAudit(db: Db, limit = 100) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(Math.min(limit, 500));
}

/* ---------- export ---------- */

const EXPORT_COLUMNS: [keyof Awaited<ReturnType<typeof listMembers>>[number], string][] = [
  ['name', 'name'], ['phone', 'phone'], ['email', 'email'], ['rollNo', 'roll_no'], ['degree', 'degree'],
  ['branch', 'branch'], ['batch', 'batch'], ['position', 'position'], ['organisation', 'organisation'],
  ['homeDistrict', 'home_district'], ['workDistrict', 'work_district'], ['workState', 'work_state'],
  ['linkedin', 'linkedin'], ['skills', 'skills'], ['openToMentor', 'open_to_mentor'], ['status', 'status'],
  ['role', 'role'], ['title', 'title'], ['batchMatch', 'batch_match'], ['source', 'source'], ['createdAt', 'registered_at'],
];

/** CSV of members in the same column format the importer accepts. */
export async function exportMembersCsv(db: Db, status?: Member['status']) {
  const rows = await db
    .select(PUBLIC_COLUMNS)
    .from(members)
    .where(status ? eq(members.status, status) : undefined)
    .orderBy(members.batch, members.name);
  return stringify(
    rows.map((r) => EXPORT_COLUMNS.map(([k]) => {
      const v = r[k];
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'boolean') return v ? 'yes' : 'no';
      return v ?? '';
    })),
    { header: true, columns: EXPORT_COLUMNS.map(([, h]) => h), bom: true },
  );
}
