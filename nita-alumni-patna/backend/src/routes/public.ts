import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { BIHAR_DISTRICTS, BRANCHES, DEGREES, FIRST_BATCH_YEAR, WORK_STATES } from '../lib/reference.js';
import { fieldErrors, joinInput } from '../members/schemas.js';
import { registerFromForm } from '../members/service.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const read = (f: string) => readFileSync(join(PUBLIC_DIR, f), 'utf8');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const options = (list: readonly (string | number)[]) => list.map((v) => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');

function joinPage() {
  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= FIRST_BATCH_YEAR; y--) years.push(y);
  return read('join.html')
    .replace('{{DEGREES}}', options(DEGREES))
    .replace('{{BRANCHES}}', options(BRANCHES))
    .replace('{{YEARS}}', options(years))
    .replace('{{DISTRICTS}}', options(BIHAR_DISTRICTS))
    .replace('{{STATES}}', options(WORK_STATES));
}

// The form page loads only its own script and styles, plus Google Fonts.
const FORM_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export default async function publicRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const page = joinPage();
  const assets: Record<string, [string, string]> = {
    '/join.css': ['text/css; charset=utf-8', read('join.css')],
    '/join.js': ['text/javascript; charset=utf-8', read('join.js')],
    '/emblem.svg': ['image/svg+xml', read('emblem.svg')],
  };

  app.get('/', (_req, reply) => reply.redirect('/join'));
  app.get('/join', (_req, reply) =>
    reply.header('content-security-policy', FORM_CSP).header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(page),
  );
  for (const [path, [type, body]] of Object.entries(assets)) {
    app.get(path, (_req, reply) => reply.header('cache-control', 'public, max-age=3600').type(type).send(body));
  }

  app.get('/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  });

  app.get('/api/v1/reference', async () => ({
    degrees: DEGREES, branches: BRANCHES, homeDistricts: BIHAR_DISTRICTS, workStates: WORK_STATES, firstBatchYear: FIRST_BATCH_YEAR,
  }));

  app.post(
    '/api/v1/join',
    {
      bodyLimit: 6 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const parsed = joinInput.safeParse(req.body);
      if (!parsed.success) throw badRequest('Some details need fixing', { fields: fieldErrors(parsed.error) });
      const m = await registerFromForm(db, parsed.data);
      return reply.code(201).send({ id: m.id, name: m.name, status: m.status });
    },
  );
}
