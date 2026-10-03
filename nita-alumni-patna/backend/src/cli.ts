// Command-line admin tools. Run with: npm run cli -- <command> [options]
// In production (Docker): docker compose exec api node dist/cli.js <command> [options]
import { readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import 'dotenv/config';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { AppError } from './lib/errors.js';
import { adminCreateInput, fieldErrors } from './members/schemas.js';
import {
  approveMember, createByAdmin, exportMembersCsv, findMember, importBatchList, importMembers, listMembers,
  rejectMember, setRole,
} from './members/service.js';

const HELP = `NITA Alumni Patna — admin command line

Usage: npm run cli -- <command> [options]

  migrate                              Create or update the database tables
  member:create  --name --phone --batch --branch --degree --home-district
                [--roll --email --position --organisation --work-district --work-state
                 --linkedin --skills --mentor --status verified|pending]
                                       Create one account (verified unless --status pending)
  members:import <file.csv> [--dry-run] [--status verified|pending]
                                       Create accounts from a spreadsheet (CSV). Try --dry-run first
  members:list  [--status pending|verified|rejected|suspended] [--search text]
  members:export <file.csv> [--status ...]
                                       Save members to a CSV file
  member:approve <mobile|roll|id>
  member:reject  <mobile|roll|id> --reason "..."
  admin:make     <mobile|roll|id> [--title President]
                                       Make a verified member an admin
  batch:import   <file.csv>            Load or update the institute batch list

Every command accepts --by "Your name" to record who made the change.
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' }, phone: { type: 'string' }, batch: { type: 'string' }, branch: { type: 'string' },
    degree: { type: 'string' }, 'home-district': { type: 'string' }, roll: { type: 'string' }, email: { type: 'string' },
    position: { type: 'string' }, organisation: { type: 'string' }, 'work-district': { type: 'string' },
    'work-state': { type: 'string' }, linkedin: { type: 'string' }, skills: { type: 'string' }, mentor: { type: 'boolean' },
    status: { type: 'string' }, 'dry-run': { type: 'boolean' }, search: { type: 'string' }, reason: { type: 'string' },
    title: { type: 'string' }, by: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});

const [command, arg] = positionals;
const actor = `cli:${values.by ?? userInfo().username}`;

function need<T>(v: T | undefined, msg: string): T {
  if (v === undefined || v === '') {
    console.error(msg);
    process.exit(2);
  }
  return v;
}

async function main() {
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  const url = need(process.env.DATABASE_URL, 'Set DATABASE_URL (see .env.example)');
  const { db, pool } = createDb(url);
  try {
    switch (command) {
      case 'migrate':
        await runMigrations(pool, (m) => console.log(m));
        console.log('Database is up to date.');
        break;

      case 'member:create': {
        const r = adminCreateInput.safeParse({
          name: values.name, phone: values.phone, batch: values.batch, branch: values.branch, degree: values.degree,
          homeDistrict: values['home-district'], rollNo: values.roll, email: values.email, position: values.position,
          organisation: values.organisation, workDistrict: values['work-district'], workState: values['work-state'],
          linkedin: values.linkedin, skills: values.skills, openToMentor: values.mentor, status: values.status,
        });
        if (!r.success) {
          console.error('Not created. Fix these:');
          for (const [k, v] of Object.entries(fieldErrors(r.error))) console.error(`  ${k}: ${v}`);
          process.exitCode = 2;
          break;
        }
        const m = await createByAdmin(db, r.data, actor);
        console.log(`Created ${m.name} (${m.phone}), status ${m.status}, batch list: ${m.batchMatch}. Id ${m.id}`);
        break;
      }

      case 'members:import': {
        const file = need(arg, 'Give the CSV file: npm run cli -- members:import members.csv');
        const status = (values.status ?? 'verified') as 'verified' | 'pending';
        if (!['verified', 'pending'].includes(status)) throw new Error('--status must be verified or pending');
        const s = await importMembers(db, await readFile(file, 'utf8'), { dryRun: !!values['dry-run'], status, actor });
        console.log(s.dryRun ? `Dry run of ${file}: nothing was saved.` : `Imported ${file}.`);
        console.log(`  Rows: ${s.total}  ${s.dryRun ? 'Would create' : 'Created'}: ${s.dryRun ? s.wouldCreate : s.created}  Already registered: ${s.alreadyRegistered}  Need fixing: ${s.invalid}`);
        if (s.ignoredColumns.length) console.log(`  Ignored columns: ${s.ignoredColumns.join(', ')}`);
        for (const row of s.rows.filter((x) => x.result === 'invalid')) {
          console.log(`  Row ${row.row} (${row.name || 'no name'}): ${Object.entries(row.errors ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
        }
        if (s.invalid) process.exitCode = 1;
        break;
      }

      case 'members:list': {
        const rows = await listMembers(db, { status: values.status as never, q: values.search, limit: 500 });
        for (const m of rows) {
          console.log([m.status.padEnd(9), m.phone.padEnd(14), String(m.batch), m.name, `${m.branch}`, `batch list: ${m.batchMatch}`, m.title ?? ''].join('  '));
        }
        console.log(`${rows.length} member(s)`);
        break;
      }

      case 'members:export': {
        const file = need(arg, 'Give the output file: npm run cli -- members:export members.csv');
        await writeFile(file, await exportMembersCsv(db, values.status as never));
        console.log(`Saved ${file}`);
        break;
      }

      case 'member:approve': {
        const m = await findMember(db, need(arg, 'Give a mobile number, roll number or id'));
        const r = await approveMember(db, m.id, actor);
        console.log(`Approved ${r.name} (${r.phone}).`);
        break;
      }

      case 'member:reject': {
        const m = await findMember(db, need(arg, 'Give a mobile number, roll number or id'));
        const r = await rejectMember(db, m.id, need(values.reason, 'Give --reason "..." (shown to the applicant)'), actor);
        console.log(`Rejected ${r.name}: ${r.rejectReason}`);
        break;
      }

      case 'admin:make': {
        const m = await findMember(db, need(arg, 'Give a mobile number, roll number or id'));
        if (m.status !== 'verified') await approveMember(db, m.id, actor);
        const r = await setRole(db, m.id, 'admin', values.title ?? m.title ?? null, actor);
        console.log(`${r.name} is now an admin${r.title ? ` (${r.title})` : ''}.`);
        break;
      }

      case 'batch:import': {
        const file = need(arg, 'Give the CSV file: npm run cli -- batch:import batch-list.csv');
        const r = await importBatchList(db, await readFile(file, 'utf8'), actor);
        console.log(`Batch list: ${r.upserted} rows saved, ${r.skipped.length} skipped. Re-checked ${r.rematchedPending} pending registration(s).`);
        for (const s of r.skipped) console.log(`  Row ${s.row}: ${s.reason}`);
        break;
      }

      default:
        console.error(`Unknown command "${command}".\n`);
        console.log(HELP);
        process.exitCode = 2;
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(err.message);
      process.exitCode = 1;
    } else throw err;
  } finally {
    await pool.end();
  }
}

await main();
