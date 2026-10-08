/**
 * Weekly voice-improvement report for the team, from shops that opted in:
 * the commands most often not understood, words most often corrected, and new items added by voice.
 *
 *   npm run voice:report              # last 7 days, markdown to stdout
 *   npm run voice:report -- --days 30
 *   npm run voice:report -- --purge   # also delete events older than the retention period
 */
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { createDb } from '../db/index.js';
import { purgeOldVoiceEvents, VOICE_LOG_RETENTION_DAYS } from '../modules/learning/learning.service.js';

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 7;
const { db, pool } = createDb(config.DATABASE_URL);
const since = sql`now() - make_interval(days => ${days})`;

const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];

const totals = await rows<{ outcome: string; n: number; shops: number }>(sql`
  select outcome, count(*)::int as n, count(distinct store_id)::int as shops
  from voice_events where created_at >= ${since} group by outcome order by outcome`);
const notUnderstood = await rows<{ text: string; language: string; n: number }>(sql`
  select lower(text) as text, language, count(*)::int as n
  from voice_events where created_at >= ${since} and outcome = 'not_understood'
  group by 1, 2 order by n desc limit 25`);
const unsure = await rows<{ kind: string; heard: string; n: number }>(sql`
  select i->>'kind' as kind, lower(i->>'heard') as heard, count(*)::int as n
  from voice_events, jsonb_array_elements(details->'issues') i
  where created_at >= ${since} and outcome = 'needs_input'
  group by 1, 2 order by n desc limit 25`);
const corrected = await rows<{ heard: string; learned: string; n: number }>(sql`
  select lower(details->>'heard') as heard, coalesce(details->'learned'->>'name', '(not learned)') as learned, count(*)::int as n
  from voice_events where created_at >= ${since} and outcome = 'corrected'
  group by 1, 2 order by n desc limit 25`);

const table = (head: string[], body: (string | number)[][]) =>
  body.length
    ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`)].join('\n')
    : '_None._';

console.log(`# Voice report · last ${days} days\n`);
console.log(table(['Outcome', 'Events', 'Shops'], totals.map((t) => [t.outcome, t.n, t.shops])));
console.log('\n## Not understood at all\nAdd patterns for these to `src/modules/assistant/parser.ts`.\n');
console.log(table(['Said', 'Language', 'Times'], notUnderstood.map((r) => [r.text, r.language, r.n])));
console.log('\n## Understood partly (shopkeeper had to answer)\n');
console.log(table(['Kind', 'Heard', 'Times'], unsure.map((r) => [r.kind, r.heard, r.n])));
console.log('\n## Corrections\nFrequent ones across shops are candidates for default aliases or new rules.\n');
console.log(table(['Heard', 'Meant', 'Times'], corrected.map((r) => [r.heard, r.learned, r.n])));

if (args.includes('--purge')) {
  const n = await purgeOldVoiceEvents(db);
  console.log(`\nDeleted ${n} event(s) older than ${VOICE_LOG_RETENTION_DAYS} days.`);
}
await pool.end();
