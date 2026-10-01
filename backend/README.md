# Aawaz CRM — Backend API

REST API for the Aawaz CRM, used by the Android and iOS apps (and any web client).

**Stack:** Node.js 20+ · TypeScript · [Fastify](https://fastify.dev) · PostgreSQL · [Drizzle ORM](https://orm.drizzle.team) · Zod · JWT

Current scope: **login & user management**.

## Quick start

```bash
cd backend
cp .env.example .env          # then edit JWT_ACCESS_SECRET and ADMIN_PASSWORD
npm install

# Start PostgreSQL (or point DATABASE_URL at an existing server)
docker compose up -d db

npm run seed:admin            # applies migrations and creates the first admin
npm run dev                   # http://localhost:3000
```

Run everything in Docker instead: `docker compose up --build`.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Integration tests (needs Postgres; see below) |
| `npm run db:generate` | Generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (the server also does this on start-up) |
| `npm run seed:admin` | Create the admin from `ADMIN_*` env vars (skips if it exists) |

Tests use the database in `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/aawaz_test`) and **truncate its tables**, so never point it at real data.

## Authentication model (for the mobile apps)

- `login` / `register` return a short-lived **access token** (JWT, 15 min by default) and a long-lived **refresh token** (30 days).
- Send the access token on every request: `Authorization: Bearer <accessToken>`.
- When a request returns `401`, call `POST /api/v1/auth/refresh` with the refresh token. You get a **new pair**; the old refresh token stops working (rotation).
- Store the refresh token in secure storage (Android Keystore / iOS Keychain, e.g. `expo-secure-store`, `flutter_secure_storage`).
- If an already-used refresh token is presented again, the whole session is revoked (theft protection). So the app must **serialize refreshes**: if several requests get a `401` at once, call refresh once and let the others wait for it.
- Deactivating a user or changing their role takes effect on their next request; it doesn't wait for the access token to expire.

## Roles

| Role | Can do |
| --- | --- |
| `admin` | Everything, including creating/editing users and resetting passwords |
| `manager` | View the user list and user details |
| `agent` | Own profile only (default for new accounts) |

Users are never hard-deleted; deactivate them with `PATCH /users/:id { "isActive": false }`.

## API reference

Base URL: `/api/v1`. All bodies are JSON. Errors look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{ "path": "email", "message": "Invalid email address" }] } }
```

Error codes: `VALIDATION_ERROR`/`BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

### Auth — `/api/v1/auth`

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/register` | — | `name, email, password, phone?, deviceName?` | `201` session |
| POST | `/login` | — | `email, password, deviceName?` | session |
| POST | `/refresh` | — | `refreshToken` | session (new tokens) |
| POST | `/logout` | Bearer | `refreshToken` | `204`, ends this device's session |
| POST | `/logout-all` | Bearer | — | `204`, ends all sessions |
| GET | `/me` | Bearer | — | `{ user }` |
| PATCH | `/me` | Bearer | `name?, phone?` | `{ user }` |
| POST | `/change-password` | Bearer | `currentPassword, newPassword, deviceName?` | session (all other devices signed out) |

A **session** response:

```json
{
  "user": { "id": "…", "email": "asha@example.com", "name": "Asha", "phone": null, "role": "agent", "isActive": true, "lastLoginAt": "…", "createdAt": "…", "updatedAt": "…" },
  "accessToken": "eyJ…",
  "accessTokenExpiresIn": 900,
  "refreshToken": "…",
  "tokenType": "Bearer"
}
```

Rules: emails are case-insensitive. Passwords need 8+ characters (at most 72 bytes), including a letter and a number. Phone numbers are 7–15 digits with an optional leading `+`. `register`, `login`, `refresh` and `change-password` are limited to 10 requests per minute per IP; everything else to 300.
`register` can be turned off with `ALLOW_PUBLIC_SIGNUP=false`, so only admins can create accounts.

### Users — `/api/v1/users`

| Method | Path | Role | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/` | admin, manager | `?page=1&limit=20&search=&role=&isActive=` | `{ data: [user], pagination: { page, limit, total, totalPages } }` |
| GET | `/:id` | admin, manager | — | `{ user }` |
| POST | `/` | admin | `name, email, password, phone?, role?` | `201 { user }` |
| PATCH | `/:id` | admin | `name?, phone?, role?, isActive?` | `{ user }` |
| POST | `/:id/reset-password` | admin | `newPassword` | `204`, signs the user out everywhere |

`search` matches name, email and phone. Admins can't deactivate or demote themselves.

### Health

`GET /health` returns `{ "status": "ok" }` when the API and the database are reachable.

## Project layout

```
src/
  app.ts                 Fastify app: plugins, error handling, route registration
  server.ts              Entry point: migrate, listen, graceful shutdown
  config.ts              Validated environment variables
  db/                    Drizzle schema, connection pool, migration runner
  plugins/auth.ts        JWT + `authenticate` / `requireRole` guards
  modules/auth/          Register, login, refresh, logout, profile, password
  modules/users/         Admin user management
  lib/                   Errors, validation, password hashing, token helpers
drizzle/                 Generated SQL migrations (commit these)
test/                    Integration tests (Vitest + real PostgreSQL)
```

## Production notes

- Set a long random `JWT_ACCESS_SECRET` and `NODE_ENV=production`. Serve over HTTPS (behind a load balancer or reverse proxy).
- The API is stateless, so you can run several instances behind a load balancer. Note that the rate limiter keeps counts in memory per instance; use a Redis store for `@fastify/rate-limit` if you need shared limits.
- Expired and revoked refresh tokens stay in `refresh_tokens`. Add a periodic cleanup (e.g. `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`) once volume grows.
