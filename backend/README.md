# AwaazCRM — Backend API

Backend for **AwaazCRM**, the voice-first bahi-khata for kirana shops, built from the "Aawaz CRM"
design canvas. The shopkeeper speaks ("Ramesh ko paanch kilo atta… udhaar mein likh do") and the
app turns it into a bill, updates stock and the customer's khata, and sends a receipt on WhatsApp.

**Stack:** Node.js 20+ · TypeScript · [Fastify](https://fastify.dev) · PostgreSQL · [Drizzle ORM](https://orm.drizzle.team) · Zod · JWT

## How the design maps to the API

| Design screen | API |
| --- | --- |
| 4a · Welcome & number check | `POST /auth/otp/request`, `POST /auth/otp/verify` |
| 4b · Shop details | `POST /store`, `PATCH /store` |
| 4c · GST & PAN (optional) | `PUT /store/tax` (GSTIN check digit, scheme regular/composition, MRP-inclusive pricing; fills PAN + state) |
| 4d · Language & reply style | `PUT /store/preferences` |
| 4e · Add items (saamaan) | `POST /items/bulk`, `POST /items` |
| 4f · Ready | `POST /store/onboarding/complete` |
| 1 · Voice billing | `POST /assistant/message` → draft · `POST /bills/:id/resolve` ("Kaunsa size?") · `PATCH /bills/:id` ("Badlo") · `POST /bills/:id/confirm` ("Haan, pakka karo") |
| 2 · Khata — "kitna baaki hai?" | `POST /assistant/message`, `GET /customers/:id/ledger`, `POST /customers/:id/payments` ("Paisa mila"), `POST /customers/:id/reminders` ("Yaad dilao") |
| 3 · Daily summary | `GET /summary/daily` + sent to the owner automatically at 9 pm |
| 5 · Low confidence + weak network | `unclear` issues with best-guess options; offline bills via `POST /bills` with `clientId` |
| 6 · Customer's receipt | `/r/:token` page (tax invoice / bill of supply / bill), `GET /public/receipts/:token`; WhatsApp receipt for **udhaar bills only** |
| 7 · Customer list | `GET /customers?filter=all|dues|inactive` |
| 8 · Customer's own profile | `/c/:token` page, `GET /public/customers/:token`, opt-out and delete-request |

All `/api/v1/...` paths below are relative to `/api/v1`.

## Quick start

```bash
cd backend
cp .env.example .env          # set the two secrets; OTP_DEV_ECHO=true for local testing
npm install
docker compose up -d db       # or point DATABASE_URL at your own PostgreSQL
npm run seed:demo             # optional: the "Sharma Kirana Store" from the design
npm run dev                   # http://localhost:3000
```

Try it (with `OTP_DEV_ECHO=true` the code comes back in the response):

```bash
curl -s localhost:3000/api/v1/auth/otp/request -H 'content-type: application/json' -d '{"phone":"9876543450"}'
curl -s localhost:3000/api/v1/auth/otp/verify  -H 'content-type: application/json' -d '{"phone":"9876543450","code":"<devCode>"}'
curl -s localhost:3000/api/v1/assistant/message -H "authorization: Bearer <accessToken>" -H 'content-type: application/json' \
  -d '{"text":"Ramesh ko paanch kilo atta, ek kilo toor dal, do sarson tel… udhaar mein likh do"}'
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | Type-check |
| `npm test` | Unit + integration tests (needs PostgreSQL, see below) |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (the server also does this on start-up) |
| `npm run seed:demo` | Demo shop, items and customers from the design (not in production) |

Tests use `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/aawaz_test`) and **wipe its tables**.

## Key concepts

- **Money** is always an integer number of **paise** in responses (`74500` = ₹745). Requests take **rupees** (`"amount": 500`, `"price": 245`), which is easier to type and say.
- **Items** are sellable variants: "Atta 5 kg" (a 5 kg bag) and "Sarson tel 500 ml" are separate items. Variants share a `name` and differ in `unit` + `unitSize`. `stock` counts packs.
- **Bills** start as **drafts**. Nothing changes until `confirm`. On confirm the bill gets the next number, stock goes down, an udhaar bill is added to the khata, and the customer gets a receipt (if they have a phone number and haven't opted out).
- **Issues** are the questions a draft still has to answer. `canConfirm` is true when there are none:

  | `kind` | Meaning | Resolve with |
  | --- | --- | --- |
  | `choose_variant` | Product known, size not ("Kaunsa size?") | `itemId` from `options` |
  | `unclear` | Not heard clearly ("m…l?") or sounds like several products | `itemId` from `options` |
  | `not_found` | Not in the catalogue | `itemId`, or `name` + `unitPrice` |
  | `price_missing` | Item has no price yet | `unitPrice` (+ `savePrice: true` to remember it) |
  | `customer_unknown` / `customer_ambiguous` / `customer_required` | Who is this bill for? | `customerId` or `newCustomer` |

  Any issue can also be dropped with `remove: true`.
- **Khata** is an append-only ledger per customer (`bill`, `payment`, `bill_cancelled`), and each entry records `balanceAfter`. `customer.balance` is the running total (positive = customer owes the shop).
- **Paying part now** ("200 abhi diye, baaki udhaar"): an udhaar bill can carry `upfront { amount, method }`. On confirm the bill records `paidCash`, `paidUpi` and `creditAmount` (they add up to `total`), and only `creditAmount` goes into the khata. A customer's `totalPurchases − totalPaid = balance`, as on the profile screen.
- **Wrong payment entered**: `POST /customers/:id/ledger/:entryId/reverse` adds a `payment_reversed` entry. History is never edited or deleted, and each payment can be reversed once.
- **Replies**: assistant responses include `reply: { text, speak }`, in the shop's language (`hinglish` or `hi`). `speak` follows the shop's reply style, so the app knows to read it aloud.

## Authentication

Sign-in is by phone number with a 6-digit OTP. There are no passwords.

1. `POST /auth/otp/request { phone }`: accepts `9876543210`, `09876543210`, `+91 98765 43210`. You can request one code every 30 s, and at most 5 per hour. Each code is valid for 5 minutes.
2. `POST /auth/otp/verify { phone, code, deviceName? }`: returns `accessToken` (15 min), `refreshToken` (30 days), `user`, `store` (null until set up) and `isNewUser`. After 5 wrong attempts you must request a new code.
3. Send `Authorization: Bearer <accessToken>`. On `401`, call `POST /auth/refresh { refreshToken }` to get a new pair. Each refresh token works once; reusing one ends that login on every device that shares it. Run **one refresh at a time** in the app.

`POST /auth/logout { refreshToken }` · `POST /auth/logout-all` · `GET /auth/me` · `PATCH /auth/me { name }`

Every shop endpoint returns `409 STORE_NOT_SET_UP` until `POST /store` has been called.

## API reference

Errors always look like `{ "error": { "code": "...", "message": "...", "details": ... } }`.
Codes: `VALIDATION_ERROR` (400), `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` / `STORE_NOT_SET_UP` / `BILL_HAS_ISSUES` / `BILL_NOT_DRAFT` / `OPTED_OUT` / `REMINDER_TOO_SOON` / `NO_CONSENT` / `GST_RATE_MISSING` / `ALREADY_REVERSED` (409), `RATE_LIMITED` (429).

### Assistant — `POST /assistant/message`

```json
{ "text": "Ramesh ka kitna baaki hai?", "source": "voice", "clientId": "optional-idempotency-key" }
```

`text` is the transcript (from the phone's speech recognition) or typed text. Response: `{ intent, reply: { text, speak }, ...data }`.

| Example | `intent` | Extra data |
| --- | --- | --- |
| "Ramesh ko paanch kilo atta, do sarson tel… udhaar mein likh do" | `create_bill` | `bill` (draft) |
| "Ramesh ka kitna baaki hai?" · "Sunita ka khata" | `query_balance` | `customer`, `recentEntries` |
| "Ramesh ne paanch sau rupaye diye UPI se" | `record_payment` | `customer`, `entry` |
| "Ramesh ko yaad dilao" | `send_reminder` | `customer` |
| "Grahak list dikhao" | `list_customers` | `customers`, `total`, `totalDues` |
| "Aaj ka hisaab" | `daily_summary` | `summary` |
| "Kaunsa stock kam hai" | `low_stock` | `items` |
| anything else | `unknown` | — |

When a named customer isn't found or several match, the response has `needsInput` and nothing is written.
The parser understands romanised Hindi/Hinglish: number words (ek … sau, hazaar, aadha, dedh, dhai), units (kilo, gram, litre, ml, packet…), Devanagari digits and spelling variants (aata/atta, daal/dal).

### Bills — `/bills`

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/` | `?status=&customerId=&from=YYYY-MM-DD&to=&page=&limit=` | Newest first |
| POST | `/` | `{ clientId?, customerId?, paymentMode, upfront?: { amount, method }, lines: [{ itemId, quantity, unitPrice? } \| { name, quantity, unitPrice, gstRate?, hsnCode? }], confirm? }` | Manual / offline bills. Same `clientId` → same bill (200), never a duplicate |
| GET | `/:id` | — | Lines, customer, `issues`, `canConfirm`, `receiptLink` |
| PATCH | `/:id` | `{ customerId?, paymentMode?, upfront?, lines? }` | Draft only. `lines` replaces all lines |
| POST | `/:id/resolve` | `{ issueId, itemId? \| name+unitPrice? \| unitPrice? \| customerId? \| newCustomer? \| remove? , quantity?, savePrice? }` | Answers one issue |
| POST | `/:id/confirm` | — | Returns `bill`, `effects { stockReduced, khata { before, after }, receiptQueued, customerLink }`, `reply { title, lines }` |
| POST | `/:id/cancel` | — | Draft: discard. Confirmed: restores stock and reverses khata |

`paymentMode`: `cash` · `upi` · `udhaar`. Udhaar needs a customer and a shop with `givesCredit: true`.

### Store — `/store`

`POST /` `{ name, ownerName, city, state?, pincode?, address?, givesCredit }` · `GET /` (store + `onboarding.steps { number, shop, language, items }`) · `PATCH /` (same fields + `summaryTime "HH:MM"`) · `PUT /tax` `{ gstin?, gstScheme?, pan?, legalName?, pricesIncludeTax? }` (null removes; a GSTIN needs a scheme) · `PUT /preferences` `{ language: hi|hinglish, replyStyle: voice_text|text }` · `POST /onboarding/complete`

### Items — `/items`

`GET /?search=` · `GET /low-stock` · `POST /` · `POST /bulk { items: [...] }` (same name+size updates instead of duplicating; returns `missingPrice`) · `GET /:id` · `PATCH /:id` · `POST /:id/stock { delta }` · `DELETE /:id` (deactivates)

Item fields: `name, aliases[], unit (kg|g|l|ml|pc), unitSize, price (rupees or null), gstRate (% or null), hsnCode, stock, stockLabel, lowStockThreshold`. Responses add `displayName` ("Sarson tel 500 ml").

### Customers — `/customers`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/?filter=all\|dues\|inactive&search=&page=&limit=` | Biggest dues first; `counts { all, dues, inactive }`, `totalDues`. Inactive = no purchase for 14 days |
| POST | `/` | `{ name, phone?, gstin?, messagingConsent? }` |
| GET | `/:id` | Customer, khata summary, `shareLink` (their private page) |
| PATCH | `/:id` | `{ name?, phone?, gstin?, messagingConsent? }` |
| GET | `/:id/ledger?page=&limit=` | Khata history, newest first |
| POST | `/:id/payments` | `{ amount (rupees), method: cash\|upi, note?, clientId? }`; the same `clientId` is recorded once |
| POST | `/:id/ledger/:entryId/reverse` | `{ note? }`: undo a payment entered by mistake |
| POST | `/:id/reminders` | WhatsApp reminder of the balance; once per 24 h; respects opt-out |

### Summary — `GET /summary/daily?date=YYYY-MM-DD`

Sales total, bill count (and how many by voice), cash / UPI / udhaar split, udhaar recovered, new customers, low stock, top dues. Days follow the shop's time zone (`Asia/Kolkata`). The same summary is sent to the owner each day at `summaryTime` (default 21:00).

### Customer-facing (no login, token in the link)

- Pages: `GET /c/:token` (khata) and `GET /r/:token` (receipt). These are the links in WhatsApp messages.
- JSON: `GET /public/customers/:token`, `GET /public/receipts/:token`
- `POST /public/customers/:token/opt-out` / `opt-in` ("Messages band karo")
- `POST /public/customers/:token/delete-request` ("Meri jaankari hatao"): with nothing due, personal details are removed at once. Otherwise the request is flagged for the shopkeeper (`deletionRequestedAt`) and `{ deleted: false, reason: "BALANCE_DUE" }` is returned.

## GST

`documentType` is set when a bill is confirmed, from the shop's setup (`PUT /store/tax`):

| Shop | Document | Tax |
| --- | --- | --- |
| GSTIN + `gstScheme: "regular"` | `tax_invoice` | Per line from the item's `gstRate`: CGST + SGST, or IGST when a B2B customer's GSTIN is in another state |
| GSTIN + `gstScheme: "composition"` | `bill_of_supply` | None; it carries the composition-scheme statement |
| No GSTIN | `bill` | None; no GSTIN is printed |

- Prices are treated as **tax-inclusive (MRP)** by default. The tax is worked out from inside the price, so the customer pays the shelf price. Set `pricesIncludeTax: false` to add tax on top instead.
- Items carry `gstRate` (percent) and `hsnCode`. A tax invoice can't be confirmed while any line lacks a rate (`409 GST_RATE_MISSING`).
- Invoice numbers run per financial year (April–March): `2026-27/0001`. Cancelled invoices keep their number and stay on record.
- Customers can have a `gstin` for B2B invoices.
- `GET /reports/gst?from=YYYY-MM-DD&to=YYYY-MM-DD` gives your CA: totals by rate, by HSN, B2B invoices, documents issued and cancelled.

**Have a CA confirm before going live:** the GST rate and HSN code for each product (rates change); whether your turnover requires HSN on B2C invoices; and the invoice fields required for your shop. **Not supported yet:** credit/debit notes (a cancelled invoice is excluded from the report, not offset by a credit note), e-invoicing, and reverse charge.

## Messages (OTP, receipts, reminders, summaries)

**Who gets what:**
- **Receipts** go only for **udhaar bills**, which keeps WhatsApp costs down. Cash and UPI bills send nothing.
- **Receipts and reminders** go only to customers with a phone number, **recorded consent** and no opt-out. Consent comes from the shopkeeper (`messagingConsent: true` when creating or editing a customer, after asking the customer) or from the customer tapping opt-in on their own link. A reminder without consent returns `409 NO_CONSENT`. Confirm the exact consent requirements under the DPDP Act and WhatsApp's policies with a lawyer.


Outgoing messages go through the `MessageSender` interface (`src/messaging/sender.ts`). Receipts, reminders and summaries are written to an `outbound_messages` queue in the same transaction as the change that caused them. A background worker then delivers them with retries and backoff (`src/messaging/workers.ts`, safe to run on several instances).

**Right now messages are only logged** (`LogSender`). To send real WhatsApp/SMS messages, implement `MessageSender` for your provider (for example the WhatsApp Business Platform, or an SMS gateway for OTPs) and pass it in `src/server.ts`.

## Not included yet

These need an external provider or a product decision, so they're not built:

- **Speech-to-text.** The API takes the transcript. Use on-device recognition (Android `SpeechRecognizer`, iOS `SFSpeechRecognizer`, both support `hi-IN` / `en-IN`) or add a cloud STT service.
- **Reading photos:** GST certificate, shelf photo, or an old list from Excel/PDF (screens 4c and 4e). The app can send the extracted items to `POST /items/bulk` and the GSTIN to `PUT /store/tax`.
- **WhatsApp delivery:** see above.
- **Language coverage.** The rule-based parser handles common romanised Hinglish phrasing, not free-form Devanagari sentences. An LLM-based parser could be plugged in behind `parseCommand` later. The Hindi reply texts in `src/lib/replies.ts` should be reviewed by a native speaker.
- **Staff accounts.** One owner per shop for now.

## Project layout

```
src/
  app.ts                     Fastify app: plugins, errors, routes
  server.ts                  Entry: migrations, workers, graceful shutdown
  config.ts                  Validated environment variables
  db/schema.ts               Tables: users, otp_codes, refresh_tokens, stores, items,
                             customers, bills, bill_items, ledger_entries, outbound_messages
  plugins/auth.ts            JWT, `authenticate`, `requireStore`
  modules/
    auth/                    Phone OTP sign-in, sessions
    store/                   Shop profile, GST/PAN, preferences, onboarding
    items/                   Catalogue and stock
    customers/               Customers, khata, payments, reminders
    bills/                   Drafts, issue resolution, confirm/cancel, catalogue matching
    assistant/               Hinglish command parser + /assistant/message
    summary/                 Daily summary
    reports/                 GST report for the CA
    public/                  Customer receipt/khata pages and endpoints
  messaging/                 MessageSender interface, outbox worker, summary scheduler
  lib/                       Phone, GST, money, text matching, replies, tokens
drizzle/                     SQL migrations (commit these)
test/                        Vitest: parser unit tests + API tests on real PostgreSQL
```

## Production notes

- Set `NODE_ENV=production`, long random `JWT_ACCESS_SECRET` and `OTP_SECRET`, and `OTP_DEV_ECHO=false` (the server refuses to start with it on in production). Set `PUBLIC_BASE_URL` to the public HTTPS address.
- The API is stateless, so it can run several instances behind a load balancer. The rate limiter counts per instance (use a Redis store for shared limits). Workers are safe to run on every instance, or set `RUN_WORKERS=false` on all but one.
- Clean up old rows periodically once volume grows: expired `otp_codes` and `refresh_tokens`, and sent `outbound_messages`.
