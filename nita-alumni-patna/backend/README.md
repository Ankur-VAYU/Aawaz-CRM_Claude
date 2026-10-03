# Backend

Node.js 20+ · TypeScript · Fastify · PostgreSQL · Drizzle ORM · Zod

What it does today:

- `GET /join`: the public registration form (profile, photo, proof, consent)
- `POST /api/v1/join`: saves a registration as **pending** and checks it against the batch list
- Admin API under `/api/v1/admin/*` (needs `x-admin-key`): create accounts, import CSV, approve or reject, roles, batch list, export, activity log
- Command line (`src/cli.ts`): the same admin actions from a terminal

Deployment and account creation: see [`../DEPLOY.md`](../DEPLOY.md).

## Run locally

```bash
cp .env.example .env              # set ADMIN_API_KEY to any 32+ character string
npm install
docker compose -f docker-compose.dev.yml up -d   # or point DATABASE_URL at your own PostgreSQL
npm run dev                       # http://localhost:3000/join
npm run cli -- --help
```

## Tests

Tests need a PostgreSQL database they can empty:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/nita_test npm test
npm run typecheck
```

## Layout

| Path | Contents |
| --- | --- |
| `migrations/` | SQL that creates the tables; applied automatically on start and by `npm run db:migrate` |
| `src/lib/reference.ts` | Degrees, branches, Bihar districts, states: **check the branch list before launch** |
| `src/members/` | Validation (`schemas.ts`), CSV column mapping (`csv.ts`), all member logic (`service.ts`) |
| `src/routes/` | Public form and API (`public.ts`), admin API (`admin.ts`) |
| `public/` | The join form page, its styles and script, and the chapter seal |
| `templates/` | CSV templates for member import and the batch list |
| `api/index.js`, `src/vercel.ts`, `vercel.json` | Vercel deployment (serverless function, build step that creates tables) |
| `scripts/` | `backup-remote.sh` for the hosted database; `backup.sh` / `restore.sh` for the docker-compose setup |
