import { z } from 'zod';
import { normalizePhone } from '../lib/phone.js';
import {
  BIHAR_DISTRICTS, BRANCHES, DEGREES, FIRST_BATCH_YEAR, TITLES, VISIBILITY, WORK_STATES, matchOption,
} from '../lib/reference.js';

const blankToUndefined = (v: unknown) => (v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const oneOf = <T extends string>(list: readonly T[], message: string) =>
  z.string().trim().transform((v, ctx) => {
    const m = matchOption(list, v);
    if (!m) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return m;
  });

const yesNo = z.union([
  z.boolean(),
  z.string().trim().toLowerCase().transform((v, ctx) => {
    if (['yes', 'y', 'true', '1'].includes(v)) return true;
    if (['no', 'n', 'false', '0'].includes(v)) return false;
    ctx.addIssue({ code: 'custom', message: 'Use yes or no' });
    return z.NEVER;
  }),
]);

const thisYear = () => new Date().getFullYear();

/** Profile fields shared by the join form, admin creation and CSV import. */
export const memberFields = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(120),
  phone: z.string().trim().transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
      return z.NEVER;
    }
    return p;
  }),
  email: optional(z.email('Enter a valid email address').max(254)),
  rollNo: optional(
    z.string().trim().toUpperCase().max(32).regex(/^[A-Z0-9/-]+$/, 'Use only letters, digits, / and -'),
  ),
  degree: oneOf(DEGREES, `Choose one of: ${DEGREES.join(', ')}`),
  branch: oneOf(BRANCHES, 'Not a recognised branch. See the list on the join form'),
  batch: z.coerce
    .number({ message: 'Enter the passing year, e.g. 2015' })
    .int('Enter the passing year, e.g. 2015')
    .min(FIRST_BATCH_YEAR, `Passing year must be ${FIRST_BATCH_YEAR} or later`)
    .refine((y) => y <= thisYear(), 'Passing year cannot be in the future'),
  position: optional(z.string().trim().max(120)),
  organisation: optional(z.string().trim().max(160)),
  homeDistrict: oneOf(BIHAR_DISTRICTS, 'Home district must be one of the districts of Bihar'),
  workDistrict: optional(z.string().trim().max(80)),
  workState: optional(oneOf(WORK_STATES, 'Choose an Indian state or union territory, or "Outside India"')),
  linkedin: optional(z.url({ protocol: /^https?$/, message: 'Enter a full link starting with https://' }).max(300)),
  skills: optional(z.string().trim().max(300)),
  openToMentor: optional(yesNo).transform((v) => v ?? false),
  phoneVisibility: optional(z.enum(VISIBILITY)).transform((v) => v ?? 'members'),
  emailVisibility: optional(z.enum(VISIBILITY)).transform((v) => v ?? 'members'),
  vouchedBy: optional(z.string().trim().max(160)),
});
export type MemberFields = z.output<typeof memberFields>;

const FILE_TYPES = {
  'image/jpeg': (b: Buffer) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b: Buffer) => b.subarray(0, 4).toString('hex') === '89504e47',
  'image/webp': (b: Buffer) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  'application/pdf': (b: Buffer) => b.subarray(0, 4).toString() === '%PDF',
} as const;
type FileType = keyof typeof FILE_TYPES;

/** A file sent as a data: URL. Checks the declared type against the file's first bytes. */
const dataUrlFile = (allowed: FileType[], maxBytes: number, label: string) =>
  z.string().transform((v, ctx) => {
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(v);
    const type = m?.[1] as FileType | undefined;
    if (!m || !type || !allowed.includes(type)) {
      ctx.addIssue({ code: 'custom', message: `${label} must be ${allowed.map((t) => t.split('/')[1].toUpperCase()).join(', ')}` });
      return z.NEVER;
    }
    const data = Buffer.from(m[2], 'base64');
    if (data.length > maxBytes) {
      ctx.addIssue({ code: 'custom', message: `${label} must be under ${Math.round(maxBytes / 1024 / 1024)} MB` });
      return z.NEVER;
    }
    if (!FILE_TYPES[type](data)) {
      ctx.addIssue({ code: 'custom', message: `${label} is not a valid ${type.split('/')[1].toUpperCase()} file` });
      return z.NEVER;
    }
    return { type, data };
  });

/** The public join form. Stricter than import: work details and consent are required. */
export const joinInput = memberFields.extend({
  position: z.string().trim().min(2, 'Enter your current position').max(120),
  organisation: z.string().trim().min(2, 'Enter your current organisation').max(160),
  workDistrict: z.string().trim().min(2, 'Enter the city or district where you work').max(80),
  workState: oneOf(WORK_STATES, 'Choose an Indian state or union territory, or "Outside India"'),
  consent: z.literal(true, { message: 'Please confirm the details and agree to how they are shared' }),
  photo: optional(dataUrlFile(['image/jpeg', 'image/png', 'image/webp'], 1024 * 1024, 'Photo')),
  proof: optional(
    z.object({
      name: z.string().trim().max(200),
      data: dataUrlFile(['image/jpeg', 'image/png', 'application/pdf'], 3 * 1024 * 1024, 'Proof document'),
    }),
  ),
  // Honeypot: real people leave this hidden field empty.
  website: optional(z.string().max(0, 'Leave this field empty')),
});
export type JoinInput = z.output<typeof joinInput>;

/** Account creation by an admin (API or command line). Verified unless stated otherwise. */
export const adminCreateInput = memberFields.extend({
  status: optional(z.enum(['verified', 'pending'])).transform((v) => v ?? 'verified'),
  role: optional(z.enum(['member', 'moderator', 'admin'])).transform((v) => v ?? 'member'),
  title: optional(oneOf(TITLES, `Choose one of: ${TITLES.join(', ')}`)),
});
export type AdminCreateInput = z.output<typeof adminCreateInput>;

export const rejectInput = z.object({ reason: z.string().trim().min(3, 'Give a reason the applicant can act on').max(500) });
export const roleInput = z.object({
  role: z.enum(['member', 'moderator', 'admin']),
  title: optional(oneOf(TITLES, `Choose one of: ${TITLES.join(', ')}`)).nullable(),
});

/** Turns zod issues into { field: message } for forms and "field: message" lines for imports. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const key = String(i.path[0] ?? 'form');
    if (!out[key]) out[key] = i.message;
  }
  return out;
}
