import { bigserial, boolean, customType, jsonb, pgEnum, pgTable, smallint, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const memberStatus = pgEnum('member_status', ['pending', 'verified', 'rejected', 'suspended']);
export const memberRole = pgEnum('member_role', ['member', 'moderator', 'admin']);
export const memberSource = pgEnum('member_source', ['form', 'import', 'admin']);
export const batchMatch = pgEnum('batch_match', ['full', 'partial', 'none']);
export const visibility = pgEnum('visibility', ['members', 'batch', 'admins']);

// Mirrors migrations/0001_init.sql, which is the source of truth for the database.
export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 16 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 254 }),
  rollNo: varchar('roll_no', { length: 32 }),
  degree: varchar('degree', { length: 40 }).notNull(),
  branch: varchar('branch', { length: 80 }).notNull(),
  batch: smallint('batch').notNull(),
  position: varchar('position', { length: 120 }),
  organisation: varchar('organisation', { length: 160 }),
  homeDistrict: varchar('home_district', { length: 40 }).notNull(),
  homeState: varchar('home_state', { length: 40 }).notNull().default('Bihar'),
  workDistrict: varchar('work_district', { length: 80 }),
  workState: varchar('work_state', { length: 60 }),
  linkedin: varchar('linkedin', { length: 300 }),
  skills: varchar('skills', { length: 300 }),
  openToMentor: boolean('open_to_mentor').notNull().default(false),
  phoneVisibility: visibility('phone_visibility').notNull().default('members'),
  emailVisibility: visibility('email_visibility').notNull().default('members'),
  photo: bytea('photo'),
  photoType: varchar('photo_type', { length: 40 }),
  proof: bytea('proof'),
  proofType: varchar('proof_type', { length: 40 }),
  proofName: varchar('proof_name', { length: 200 }),
  vouchedBy: varchar('vouched_by', { length: 160 }),
  status: memberStatus('status').notNull().default('pending'),
  role: memberRole('role').notNull().default('member'),
  title: varchar('title', { length: 40 }),
  source: memberSource('source').notNull(),
  batchMatch: batchMatch('batch_match').notNull().default('none'),
  batchMatchNotes: text('batch_match_notes'),
  rejectReason: text('reject_reason'),
  decidedBy: varchar('decided_by', { length: 120 }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const batchRecords = pgTable('batch_records', {
  rollNo: varchar('roll_no', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  batch: smallint('batch').notNull(),
  branch: varchar('branch', { length: 80 }).notNull(),
  degree: varchar('degree', { length: 40 }).notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actor: varchar('actor', { length: 120 }).notNull(),
  action: varchar('action', { length: 60 }).notNull(),
  target: varchar('target', { length: 120 }),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
