# NIT Agartala Alumni — Patna Chapter: product and technical spec

Status: draft, prototype version 3. Items marked **Assumption** were not confirmed by the chapter
and should be reviewed.

## 1. Goal

Give NIT Agartala alumni **from Bihar, wherever they work now,** one trusted place to:

- stay informed about the institute and the chapter,
- attend chapter events, mostly in Patna,
- find and contact fellow alumni, by home district or by the city they work in,
- help each other with jobs, referrals, mentoring and personal help.

"Trusted" is the core of the product: only alumni verified by the chapter can see member details.

## 2. Decisions confirmed by the chapter

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where does the code live? | Its own repository, separate from Aawaz CRM |
| 2 | Can we get a list of graduates to check roll numbers? | Yes. Admins upload it; registrations are checked against it automatically |
| 3 | Who runs the app? | The President of the alumni chapter is the first admin |
| 4 | How are event contributions collected? | Both online and at the venue |
| 5 | Who can join? | Anyone from Bihar (home district in Bihar), wherever they work, in India or abroad |
| 6 | Hindi interface? | No. English only |

## 3. Users and roles

| Role | Who | Can do |
| --- | --- | --- |
| Visitor | Anyone with the link | See public home, upcoming events, institute updates, how to join. Sign in or register |
| Applicant | Registered, not yet verified | Edit own profile, RSVP and pay for events, see verification status. Cannot see the directory or board |
| Member | Verified alumnus | Everything above, plus directory, contact details (subject to each person's privacy settings), post and respond on the board |
| Moderator | Member appointed by an admin | Verify applicants, handle reported posts |
| Admin | The President, and anyone the President appoints | Everything, plus members and roles, committee titles, events and payments, batch list, announcements, institute updates, activity log |

Committee titles (President, Secretary, Treasurer, Joint Secretary, Committee member) are labels
shown to members. Permissions come from the role, not the title.

The President should appoint **at least one more admin** (for example the Secretary or Treasurer),
so verification and payments continue when the President is unavailable. The admin overview shows
a warning while there is only one admin.

## 4. Eligibility

- Home district must be one of Bihar's 38 districts. Home state is fixed to Bihar in the form.
- Work location can be any Indian state or union territory, or "Outside India", with a free-text city or district.
- The directory can be filtered by home district and by work place, and shows two summaries: where members work, and which Bihar districts they come from.

## 5. Features

The first prototype covered the original six requests: institute updates, events, registration
with verification, the directory, profile fields and the jobs/help board. Everything below is in
prototype v3 unless marked "Later".

### Accounts and verification
- Sign in with mobile number and a one-time code on WhatsApp. No passwords.
- Account states: applicant, verified, rejected (with a visible reason and re-submission), suspended.
- **Batch list matching.** Admins upload the institute's graduate list as CSV (`roll,name,batch,branch,degree`). Each registration shows Full match, Partial match (with what differs, for example a different name spelling) or Not found.
  - Full match ticks all three checks automatically, so approval is one click.
  - Partial match or not found needs an admin to look at the uploaded proof.
  - The list is used only for checking and is never shown to members.
- Proof upload is recommended rather than required, because most applicants should match the batch list.
- Vouching by a verified alumnus, "Ask for more information", reject with reason.
- Activity log of every admin action, including whether an approval was a batch-list match or a manual check.

### Privacy and consent
- Per-person visibility for phone and email: all verified members, only my batch, or only admins.
- Consent checkbox at registration; "Request account deletion" in settings.
- Not in prototype: written privacy policy and terms. India's Digital Personal Data Protection Act, 2023 applies to personal data collected digitally; get the policy text reviewed by someone qualified rather than relying on this document. The batch list is personal data too, so it needs the same protection.

### Events and payments
- RSVP with number of guests, capacity and places left, "Add to Google Calendar", who's going.
- Contribution set per family or per person (or free).
- **Pay online** (UPI, card, net banking through a payment gateway) or **pay at the venue** (cash or UPI). Members choose when they RSVP and can switch later.
- Members see their status: paid online, paid at venue, or amount due.
- Admin "Events & payments" view per event: expected, paid online, paid at venue, still to collect, and a list of who has paid. The treasurer marks venue payments as received; each one is logged.
- Cancelling after paying online alerts the admins that a refund is needed.
- Later: automatic refunds, receipts by WhatsApp/email, check-in at the venue, photo gallery.

### Directory
- Search by name, company, district or skill. Filters: branch, batch, home district, working state, working city/district.
- Quick filters: my batch, from my home district, working in my city, open to mentoring.
- Full profile view with WhatsApp and LinkedIn links.
- Later: export to spreadsheet for admins.

### Jobs & Help board
- Categories: vacancy, referral, help needed, offering help, mentorship. Posts can be for any state.
- Posts expire after 15, 30 or 60 days; authors mark them filled or closed and see who is interested.
- Report a post; moderators remove or dismiss. Posting rules shown in the composer.
- Members get notified of new vacancies in the state where they work.

### Communication
- In-app notifications and preferences (WhatsApp, email; topics).
- Chapter announcements with pinning, separate from institute updates.
- Later: actual WhatsApp and email delivery.

### Administration
- Admin tabs: Overview, Verify, Reports, Events & payments, Batch list, Members, Content, Activity log. Moderators see Verify and Reports only.
- Members: make moderator or admin, set committee title, suspend or reinstate.
- Overview flags: registrations waiting, reported posts, unpaid contributions, only one admin, profiles not updated in 12 months.

## 6. Phased plan

| Phase | Scope | Outcome |
| --- | --- | --- |
| 0. Prototype (done) | Clickable UI with sample data | Committee agrees on screens and rules |
| 1a. Registration backend (done) | Join form saving to PostgreSQL, batch-list matching, admin API and command line to create, import, approve and export accounts, Docker deployment with backups. See `DEPLOY.md` | Chapter can start collecting and verifying members |
| 1b. Web app | OTP login, profiles with privacy, directory, events with RSVP, online payments and venue payment recording, board with expiry and reports, announcements, manual institute updates, admin area, activity log | Chapter can onboard members and run the November meet |
| 2. Phone app | Installable web app (PWA), then Play Store; WhatsApp/email notifications and payment receipts | Members get reminders without opening the site |
| 3. Growth | Automatic refunds, photo gallery, mentoring matching, data export, automatic institute updates if feasible | Less manual work for the committee |

**Assumption:** Android first. iOS can follow from the same code.

## 7. Recommended technical approach

**Assumption:** use the same stack as the Aawaz CRM backend so the same people can maintain both.

| Part | Choice | Why |
| --- | --- | --- |
| API | Node.js 20+, TypeScript, Fastify, Zod | Same as Aawaz CRM |
| Database | PostgreSQL with Drizzle ORM | Relational data with clear rules |
| Login | Phone + OTP, short-lived access token + refresh token | The Aawaz CRM backend already has OTP sign-in with rate limits and hashed codes that can be adapted |
| Payments | An Indian payment gateway that supports UPI, cards and net banking, with webhook confirmation | Mark a payment paid only after the gateway's signed webhook confirms it, never from the browser alone. Which gateway to use is still open (see section 9) |
| Files (photos, proofs) | Object storage (S3-compatible). Proofs in a **private** bucket, served to admins through short-lived signed links | Proofs contain sensitive data |
| Images | Resize and compress profile photos on upload (for example to 512 px) | Keeps the directory fast on mobile data |
| Web app | React + TypeScript, built as a PWA | Works on any phone browser, installable |
| Android/iOS | Wrap the same web app with Capacitor | One codebase; Play Store presence |
| Messages | WhatsApp Business API provider for OTP and alerts, SMS fallback, email provider | Members already use WhatsApp |
| Hosting | Managed Postgres + container host; daily database backups kept for 30 days | Small, predictable cost |

### 7.1 Data model (main tables)

- `users`: phone (unique), name, email, photo_url, roll_no, degree, branch, batch, position, organisation, home_district (Bihar only), work_district, work_state, linkedin, skills, open_to_mentor, phone_visibility, email_visibility, status, role, title, reject_reason, verified_by, verified_at, updated_at
- `batch_records`: roll_no (unique), name, batch, branch, degree, uploaded_by, uploaded_at
- `verification_requests`: user_id, proof_file, vouched_by, batch_match (`full`, `partial`, `none`), checklist, decision, decided_by, notes
- `events` (fee_amount in paise, fee_basis `family` or `person`, capacity), `event_rsvps` (event_id, user_id, guests, pay_mode `online` or `venue`)
- `payments`: rsvp_id, amount (paise), mode (`online`, `venue`), gateway_order_id, gateway_payment_id, status (`created`, `paid`, `failed`, `refund_pending`, `refunded`), recorded_by (for venue payments), created_at
- `posts`, `post_interests`, `post_reports`
- `announcements`, `institute_updates`
- `notifications`, `notification_preferences`
- `audit_log` (actor_id, action, target, created_at)

Store money as integer paise, as the Aawaz CRM backend already does.

### 7.2 Rules the server must enforce (not just the UI)

- Directory, board and contact details are returned only to verified, non-suspended users.
- Phone and email are removed from API responses according to the owner's visibility setting.
- Registration rejects a home district outside Bihar.
- The batch list is readable only by admins and moderators, and only through the verification and lookup screens.
- An online payment is marked paid only from a verified gateway webhook. Venue payments can be recorded only by admins, and each one is written to `audit_log`.
- Applicants and suspended users cannot post.
- Posts past `expires_at` are hidden automatically.
- Only admins change roles, titles or suspensions; only staff verify or handle reports; every such action writes to `audit_log`.
- Rate limits on OTP requests, posting, reporting and payment creation.
- Proof documents are deleted a fixed period after a decision. **Assumption:** 90 days.

## 8. Operations

### 8.1 Verification procedure
1. Before launch: an admin uploads the batch list. Re-upload whenever a new batch graduates or corrections arrive.
2. Applicant registers with roll number, batch, branch, degree and home district, and optionally a proof document.
3. Full match: approve in one click. Partial match or not found: check the proof, and if needed ask the person who vouched, or use "Ask for more information".
4. Target: decision within 2 working days; the applicant is notified either way.
5. A rejection always includes a reason and allows re-submission.

### 8.2 Payments procedure
- The Treasurer (or another admin) records cash and UPI received at the venue in "Events & payments" on the day.
- After the event, reconcile: the gateway's settlement report should match "paid online", and the cash count should match "paid at venue".
- Refunds for cancellations are decided by the committee. **Assumption:** full refund if cancelled 7 days before the event.

### 8.3 Moderation
- Reported posts are reviewed within 2 days.
- Remove: fee-charging job offers, paid placement agencies, promotions unrelated to members, personal data of third parties.
- Repeat offenders are suspended by an admin, and the reason is recorded.

### 8.4 Institute updates
Pulling news automatically from www.nita.ac.in depends on how that website publishes notices. This
has **not** been checked, because the site could not be reached from the environment where this spec
was written. Phase 1: admins add updates by hand with a link to the original. Phase 3: automatic import if the
site has a stable notices page, with alerts to admins when it fails.

### 8.5 Measures of success
- Verified members, share decided within 2 days, share that were batch-list full matches
- Members by home district, and by work state
- Profiles complete and updated in the last 12 months
- RSVPs per event, attendance, share paid online, amount still to collect after the event
- Board posts per month, share marked filled, reports and time to resolve them

## 9. Open questions

1. Who besides the President should be an admin (for example Secretary and Treasurer)?
2. In whose name is the payment gateway account opened? This usually needs a bank account and documents for the chapter or a responsible person. Which gateway? Compare current fees before choosing.
3. What is the refund rule for cancellations?
4. In what format will the batch list arrive (spreadsheet, PDF), and which batches does it cover?
