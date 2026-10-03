# Deploying the NITA Alumni Patna backend

This covers the first live part of the app: the **join form** and the **admin tools** to create and
verify member accounts. The member app screens (directory, events, board) come in the next phase
and will use the same server and database.

## 1. Where is the data saved?

All data is saved in **one PostgreSQL database**. That includes member profiles, photos, proof
documents, the batch list and the activity log. The app finds the database through one setting,
`DATABASE_URL`, so the database lives wherever that address points.

Nothing is stored in the visitor's browser and nothing is sent to any other service.

| Data | Table | Notes |
| --- | --- | --- |
| Member profiles (all form fields) | `members` | One row per person; mobile number and roll number are unique |
| Profile photos and proof documents | `members` (`photo`, `proof` columns) | Kept in the database so there is only one thing to back up. Photos are resized to 512 px before upload; proofs are limited to 3 MB |
| Institute batch list | `batch_records` | Used only to check registrations |
| Who did what, and when | `audit_log` | Every registration, creation, import, approval, rejection and role change |

**Choose a server location in India** (for example a Mumbai or Bangalore region). Data stays close
to members, the app is faster for them, and questions about data leaving the country do not arise.
India's Digital Personal Data Protection Act, 2023 applies to this data. Have the privacy notice
and any data-location question checked by someone qualified.

## 2. Two ways to host it

| | Option A: one server (recommended to start) | Option B: managed services |
| --- | --- | --- |
| What you rent | One small Linux virtual server (VPS) in an India region | A managed PostgreSQL database plus a container hosting service |
| Where the database is | On that server's disk, in a Docker volume | In the provider's managed database, in the region you choose |
| Backups | `scripts/backup.sh` every night via cron, plus copying the files off the server | Usually automatic; check how long the provider keeps them |
| Effort | Someone runs a few commands to update it, and checks that backups run | Less upkeep; usually costs more |
| Files used | `docker-compose.yml`, `Caddyfile`, `scripts/` | `Dockerfile` only |

Examples of providers with India regions include AWS (Lightsail or EC2, Mumbai) and DigitalOcean
(Bangalore). Compare current plans, prices and regions on the providers' own sites before choosing.
This guide does not recommend a specific paid plan.

For a chapter of a few hundred to a few thousand members, the smallest plans are usually enough.
Each member is a few kilobytes plus a photo of roughly 50–100 KB.

## 3. Option A step by step (one server)

You need a domain or sub-domain (for example `join.yourchapter.org`) and a VPS running Ubuntu with
Docker installed.

1. **Point the domain at the server.** Add a DNS "A" record for `join.yourchapter.org` with the server's IP address.
2. **Copy the code to the server** (for example into `/opt/nita-alumni-patna`) and go to `backend/`.
3. **Create the settings file:**
   ```bash
   cp .env.example .env
   # Generate two secrets and put them in .env:
   openssl rand -hex 32   # use as ADMIN_API_KEY
   openssl rand -hex 24   # use as POSTGRES_PASSWORD
   ```
   Set `DOMAIN=join.yourchapter.org` and `NODE_ENV=production`. Leave `DATABASE_URL` as it is;
   `docker-compose.yml` sets it to the database container.
4. **Start everything:**
   ```bash
   docker compose up -d --build
   docker compose logs -f api      # should show "Applied 0001_init.sql" and "Server listening"
   ```
   Caddy gets an HTTPS certificate automatically. Open `https://join.yourchapter.org/join`.
5. **Create the President's account** (see section 4), then load the batch list.
6. **Turn on backups:**
   ```bash
   crontab -e
   # add:
   30 2 * * * /opt/nita-alumni-patna/backend/scripts/backup.sh >> /var/log/nita-backup.log 2>&1
   ```
   Then copy `backend/backups/` to another place regularly (another computer or cloud storage). A
   backup on the same disk is lost if the server is lost. Test a restore once with `scripts/restore.sh`.
7. **Firewall:** allow only ports 22 (SSH), 80 and 443. The database has no public port in `docker-compose.yml`.

To update after code changes: `git pull && docker compose up -d --build`. Database changes are
applied automatically when the app starts.

## 4. Creating accounts from the backend

There are three ways. All of them check the same rules as the join form: a valid Indian mobile
number, a home district in Bihar, a known degree and branch, no duplicate mobile or roll number. All
of them are recorded in the activity log.

On the server, the command-line tool runs inside the app container:
```bash
docker compose exec api node dist/cli.js <command> [options]
```
On a development machine use `npm run cli -- <command> [options]` instead.

### a) One person at a time

```bash
docker compose exec api node dist/cli.js member:create \
  --name "Amit Ranjan" --phone 9431120457 --roll 04UEE012 \
  --degree B.Tech --branch "Electrical Engineering" --batch 2008 \
  --home-district Bhagalpur --position "Deputy General Manager" --organisation "NTPC Barh" \
  --work-district Patna --work-state Bihar --by "Amit Ranjan"

# Make the President an admin with the title shown to members:
docker compose exec api node dist/cli.js admin:make 9431120457 --title President --by "Amit Ranjan"
```
Accounts created this way are **verified** straight away (add `--status pending` to send them
through review instead).

### b) Many people from a spreadsheet

Use this for data collected in Excel, Google Sheets or a Google Form.

1. Start from `backend/templates/members-import-template.csv`, or export your Google Form responses
   as CSV. Column names like "Mobile number" or "Batch (passing year)" are understood, and extra
   columns such as "Timestamp" are ignored. Details: `backend/templates/README.md`.
2. Copy the file to the server, then **try it without saving**:
   ```bash
   docker compose cp members.csv api:/tmp/members.csv
   docker compose exec api node dist/cli.js members:import /tmp/members.csv --dry-run
   ```
   It lists each row that needs fixing and why, for example "Row 14: phone: Enter a valid 10-digit
   mobile number".
3. Fix those rows, then import for real:
   ```bash
   docker compose exec api node dist/cli.js members:import /tmp/members.csv --by "Amit Ranjan"
   ```
   Rows already registered (same mobile or roll number) are skipped, so the same file can be
   imported again safely after corrections.

### c) Through the admin API

For a future admin screen or for tools like Postman or curl. Every request needs the header
`x-admin-key: <ADMIN_API_KEY>`. Optionally add `x-admin-name: Your Name` for the activity log.

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
curl -X POST https://join.yourchapter.org/api/v1/admin/members/import?dryRun=true \
  -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: text/csv" --data-binary @members.csv
```

## 5. Collecting data before launch

**Recommended:** share the link `https://join.yourchapter.org/join` on WhatsApp groups. It saves
straight into the database, uploads photo and proof, matches the batch list, and needs no
re-typing.

**If you already have data in a Google Form or spreadsheet:** import it with 4b. Google Form file
uploads (photos) cannot be imported from the CSV; those members add a photo later in the app.

Reviewing registrations from the form, until the admin screens are built:
```bash
docker compose exec api node dist/cli.js members:list --status pending
docker compose exec api node dist/cli.js member:approve 6201284439 --by "Amit Ranjan"
docker compose exec api node dist/cli.js member:reject 8102349076 --reason "Roll number not found in batch records" --by "Amit Ranjan"
```

## 6. Security checklist before going live

- `ADMIN_API_KEY` is long and random, shared only with admins, and changed if someone leaves the committee. Changing it means editing `.env` and running `docker compose up -d --force-recreate api`.
- `.env` is never committed to Git.
- Backups run every night and are copied off the server; a restore has been tested once.
- The site is served only over HTTPS; Caddy handles this.
- The privacy notice on the form has been reviewed.

## 7. Known limits of this first version

- Admins use a shared key instead of their own sign-in. Personal admin sign-in with OTP comes with the member app.
- No WhatsApp or email messages are sent yet. Applicants are not told automatically when they are approved.
- Photos and proofs are stored in the database. That is fine at chapter scale; move them to object storage if the database grows past a few GB.
