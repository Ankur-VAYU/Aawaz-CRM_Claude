import { parse } from 'csv-parse/sync';

// Column headers accepted in member imports. Headers are matched after lower-casing, dropping text
// in brackets and punctuation, so "Batch (passing year)" and "batch" both work. This lets a Google
// Forms or Excel export be imported without renaming columns.
const MEMBER_COLUMNS: Record<string, string[]> = {
  name: ['name', 'full name', 'full name as on degree'],
  phone: ['phone', 'mobile', 'mobile number', 'phone number', 'whatsapp number', 'mobile whatsapp number'],
  email: ['email', 'email address', 'email id'],
  rollNo: ['roll no', 'roll number', 'roll', 'enrolment number', 'enrollment number', 'roll enrolment number'],
  degree: ['degree'],
  branch: ['branch', 'department', 'branch department'],
  batch: ['batch', 'passing year', 'year of passing', 'batch passing year'],
  position: ['position', 'current position', 'designation'],
  organisation: ['organisation', 'organization', 'current organisation', 'current organization', 'company'],
  homeDistrict: ['home district', 'home district in bihar'],
  workDistrict: ['work district', 'work city', 'work city district', 'working district', 'working city', 'working city district', 'current city'],
  workState: ['work state', 'working state'],
  linkedin: ['linkedin', 'linkedin profile', 'linkedin profile url', 'linkedin url'],
  skills: ['skills', 'skills or expertise', 'expertise'],
  openToMentor: ['open to mentor', 'open to mentoring', 'mentor'],
  phoneVisibility: ['phone visibility'],
  emailVisibility: ['email visibility'],
  vouchedBy: ['vouched by', 'reference', 'referred by'],
  status: ['status'],
  role: ['role'],
  title: ['title', 'committee title'],
};

const BATCH_COLUMNS: Record<string, string[]> = {
  rollNo: ['roll no', 'roll number', 'roll', 'enrolment number', 'enrollment number'],
  name: ['name', 'full name', 'student name'],
  batch: ['batch', 'passing year', 'year of passing'],
  branch: ['branch', 'department'],
  degree: ['degree', 'programme', 'program'],
};

const normHeader = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

function lookup(columns: Record<string, string[]>) {
  const map = new Map<string, string>();
  for (const [key, aliases] of Object.entries(columns)) for (const a of aliases) map.set(a, key);
  return map;
}
const memberLookup = lookup(MEMBER_COLUMNS);
const batchLookup = lookup(BATCH_COLUMNS);

export interface ParsedCsv {
  rows: Record<string, string>[];
  ignoredColumns: string[];
  missingColumns: string[];
}

function parseWith(text: string, map: Map<string, string>, required: string[]): ParsedCsv {
  const ignored: string[] = [];
  const records: Record<string, string>[] = parse(text, {
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    columns: (headers: string[]) =>
      headers.map((h, i) => {
        const key = map.get(normHeader(h));
        if (!key) ignored.push(h);
        return key ?? `__ignored_${i}`;
      }),
  });
  const present = new Set(records.length ? Object.keys(records[0]) : []);
  const rows = records.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('__ignored_'))));
  return { rows, ignoredColumns: ignored, missingColumns: required.filter((k) => !present.has(k)) };
}

export const parseMemberCsv = (text: string) =>
  parseWith(text, memberLookup, ['name', 'phone', 'degree', 'branch', 'batch', 'homeDistrict']);
export const parseBatchCsv = (text: string) => parseWith(text, batchLookup, ['rollNo', 'name', 'batch', 'branch', 'degree']);
