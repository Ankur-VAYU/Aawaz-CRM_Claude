# Deploying the NITA Alumni Patna backend

This covers the first live part of the app: the **join form** and the **admin tools** to create and
verify member accounts. The member app screens (directory, events, board) come in the next phase
and will use the same deployment and database.

Chosen setup: **Vercel (free Hobby plan) + a free Neon PostgreSQL database**, at
`https://nitaalumini.vercel.app`.

## 1. Where is the data saved?

All data is saved in **one PostgreSQL database hosted by Neon**, created from your Vercel project.
Vercel runs the app's code but stores no data itself. The app finds the database through one
setting, `DATABASE_URL`.

| Data | Table | Notes |
| --- | --- | --- |
| Member profiles (all form fields) | `members` | One row per person; mobile number and roll number are unique |
| Profile photos | `members.photo` | Resized in the browser to 512 px (about 50–100 KB) before upload |
| Proof documents | `members.proof` | Up to 2 MB; **deleted automatically when an admin approves or rejects**. The file name stays as a record |
| Institute batch list | `batch_records` | Used only to check registrations |
| Who did what, and when | `audit_log` | Every registration, creation, import, approval, rejection and role change |

**Region:** when creating the database, pick the region closest to India that Neon offers, and set
Vercel's function region to match (step 6 below). Data then stays close to members and the app
is faster. India's Digital Personal Data Protection Act, 2023 applies to this data; have the privacy
notice and any data-location question checked by someone qualified.

## 2. Limits of the free plans (check before relying on them)

These are from my knowledge of the plans and may have changed. Check the current terms on
vercel.com and neon.tech.

- **Vercel Hobby is meant for personal, non-commercial use.** Check that a chapter website fits
  Vercel's terms. Collecting event payments later may need the paid Pro plan.
- **Vercel accepts at most 4.5 MB per request.** The form is built for this: photos are shrunk,
  certificate photos are shrunk to 1600 px, and PDFs must be under 2 MB.
- **Neon's free database is small** (around half a gigabyte when I last knew). That is enough
  for a few thousand members because photos are small and proofs are deleted after review. Watch
  the storage figure in the Neon dashboard.
- **Neon's free database sleeps when idle.** The first visit after a quiet period takes a few
  seconds longer; later visits are fast.
- **Neon's own backup history on the free plan is short.** Take your own backups (section 6).

## 3. Deploy on Vercel, step by step

You need a Vercel account (free) linked to the GitHub account that holds this code.

1. **Import the project.** On vercel.com choose *Add New → Project* and import the repository.
   - Project name: `nitaalumini`. The address becomes `https://nitaalumini.vercel.app`, if that
     name is free. Project names are lower-case, and `.vercel.app` is added automatically.
   - Root Directory: `backend` (or `nita-alumni-patna/backend` while the code is still in the
     Aawaz CRM repository).
   - Framework preset: *Other*. Build settings come from `backend/vercel.json`; leave them alone.
   - Don't deploy yet. First add the database and settings below.
2. **Create the database.** In the project, open *Storage → Create Database → Neon (Postgres)*,
   choose the free plan and a region close to India, and connect it to the project. This normally
   adds a `DATABASE_URL` environment variable to the project automatically. If it uses another
   name, add `DATABASE_URL` yourself with Neon's **pooled** connection string. That's the one whose
   host contains `-pooler`, ending in `?sslmode=require`.
3. **Add the settings** under *Settings → Environment Variables*, for the **Production** environment:
   | Name | Value |
   | --- | --- |
   | `ADMIN_API_KEY` | A long random secret. Generate one with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Share it only with admins |
   | `NODE_ENV` | `production` |
4. **Deploy.** The build compiles the app and creates the database tables. The build log should
   show `Applied 0001_init.sql` on the first deploy and `Database is up to date.` after that.
   Preview deployments skip this step, so they never change the live database.
5. **Check it works:** open `https://nitaalumini.vercel.app/health` (should show `{"ok":true}`),
   then `https://nitaalumini.vercel.app/join`.
6. **Match the regions:** *Settings → Functions → Function Region*: choose the Vercel region
   nearest your Neon database.

Every push to the main branch redeploys automatically.

## 4. Creating accounts from the backend

Vercel runs no long-lived server you can log into, so admin commands run **from an admin's own
computer** and connect straight to the same Neon database.

**One-time setup on the admin's computer** (needs Node.js 20 or newer):
```bash
git clone <this repository> && cd <repository>/backend
npm install
cp .env.example .env
# In .env, set DATABASE_URL to the Neon connection string (Neon dashboard → Connect),
# and ADMIN_API_KEY to the same value as on Vercel.
npm run cli -- --help
```
The `.env` file holds the key to all member data. Keep it only on admins' own computers and never
commit it.

All methods below apply the same rules as the join form: a valid Indian mobile number, a home
district in Bihar, a known degree and branch, no duplicate mobile or roll number. Every action is
recorded in the activity log.

### a) One person at a time

```bash
npm run cli -- member:create \
  --name "Full Name" --phone 9XXXXXXXXX --email name@example.com --roll 08UCE021 \
  --degree B.Tech --branch "Civil Engineering" --batch 2012 --home-district Patna \
  --position "Executive Engineer" --organisation "Example Org" \
  --work-district Patna --work-state Bihar --by "Your Name"

# Make someone an admin (they must exist first), with the title members will see:
npm run cli -- admin:make 9XXXXXXXXX --title President --by "Your Name"
```
Accounts created this way are **verified** straight away. Add `--status pending` to send them
through review instead.

### b) Many people from a spreadsheet

Use this for data collected in Excel, Google Sheets or a Google Form.

1. Start from `backend/templates/members-import-template.csv`, or export Google Form responses as
   CSV. Column names like "Mobile number" or "Batch (passing year)" are understood, and extra
   columns such as "Timestamp" are ignored. Details: `backend/templates/README.md`.
2. **Try it without saving:** `npm run cli -- members:import members.csv --dry-run`. It lists
   every row that needs fixing and why, for example "Row 14: phone: Enter a valid 10-digit mobile
   number".
3. Fix those rows, then import for real:
   `npm run cli -- members:import members.csv --by "Your Name"`.
   Rows already registered (same mobile or roll number) are skipped, so the same file can be
   imported again after corrections.

### c) Through the admin API

For a future admin screen, or tools like Postman or curl. Every request needs the header
`x-admin-key: <ADMIN_API_KEY>`; optionally add `x-admin-name: Your Name` for the activity log.

| Action | Request |
| --- | --- |
| List registrations | `GET /api/v1/admin/members?status=pending` |
| See one member | `GET /api/v1/admin/members/:id` (photo: `/photo`, proof: `/proof`) |
| Create one account | `POST /api/v1/admin/members` with JSON (same fields as the form; optional `status`, `role`, `title`) |
| Import a spreadsheet | `POST /api/v1/admin/members/import?dryRun=true` with the CSV as the body and `Content-Type: text/csv` |
| Approve / reject | `POST /api/v1/admin/members/:id/approve`; `POST /api/v1/admin/members/:id/reject` with `{"reason": "..."}` |
| Roles | `POST /api/v1/admin/members/:id/role` with `{"role": "admin", "title": "Treasurer"}` |
| Suspend / reinstate | `POST /api/v1/admin/members/:id/suspend`, `/reinstate` |
| Upload batch list | `POST /api/v1/admin/batch-list` with the CSV body |
| Download members | `GET /api/v1/admin/members.csv?status=verified` |
| Activity log | `GET /api/v1/admin/audit` |

Example:
```bash
curl -X POST "https://nitaalumini.vercel.app/api/v1/admin/members/import?dryRun=true" \
  -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: text/csv" --data-binary @members.csv
```
Upload limit through the API on Vercel: 4.5 MB per request. The command line has no such limit.

## 5. Collecting data and reviewing registrations

Share `https://nitaalumini.vercel.app/join` on WhatsApp groups. Registrations arrive as
**pending**. Until the admin screens are built, review them from the command line:

```bash
npm run cli -- batch:import batch-list.csv --by "Your Name"     # once, and whenever the list changes
npm run cli -- members:list --status pending
npm run cli -- member:approve 9XXXXXXXXX --by "Your Name"
npm run cli -- member:reject 9XXXXXXXXX --reason "Roll number not found in batch records" --by "Your Name"
```
To look at a proof document before deciding, open
`/api/v1/admin/members/<id>/proof` with the admin key, for example with curl:
`curl -H "x-admin-key: $ADMIN_API_KEY" -o proof.pdf https://nitaalumini.vercel.app/api/v1/admin/members/<id>/proof`

## 6. Backups

Take a backup at least weekly from an admin's computer. It needs the PostgreSQL client tools
(`pg_dump`), at the same or a newer major version than the Neon database:

```bash
scripts/backup-remote.sh            # reads DATABASE_URL from .env, writes backups/…sql.gz
```
Keep copies somewhere other than that computer, for example in a private cloud folder. Test a
restore once, into a new empty Neon database, with
`gunzip -c backups/<file>.sql.gz | psql "<new database URL>"`.

## 7. Security checklist before going live

- `ADMIN_API_KEY` is long and random, known only to admins, and changed (in Vercel and in admins' `.env`) when someone leaves the committee. Redeploy after changing it.
- `.env` files are never committed to Git.
- Backups are taken and stored off the admin's computer; a restore has been tested once.
- The privacy notice on the form has been reviewed.

## 8. Known limits of this first version

- Admins share one key instead of having their own sign-in. Personal admin sign-in with OTP comes with the member app.
- No WhatsApp or email messages are sent yet; applicants are not told automatically when they are approved.
- Rate limiting of the form is per server instance; on Vercel that is weaker than on a single server. The hidden "honeypot" field and validation still stop simple bots.

## Appendix: hosting on your own server instead

`backend/docker-compose.yml`, `Caddyfile` and `scripts/backup.sh` run the same app with its own
PostgreSQL and automatic HTTPS on one Linux server, for example if the chapter outgrows the free
plans. In short: point a domain at the server, `cp .env.example .env` and set `ADMIN_API_KEY`,
`POSTGRES_PASSWORD` and `DOMAIN`, then `docker compose up -d --build`. The command line then runs as
`docker compose exec api node dist/cli.js <command>`, and `scripts/backup.sh` can run nightly from cron.
