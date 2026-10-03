# NIT Agartala Alumni — Patna Chapter: product and technical spec

Status: draft, version 2 of the prototype. Decisions marked **Assumption** were made without
confirmation from the chapter committee and should be reviewed.

## 1. Goal

Give NIT Agartala alumni living or working in Bihar one trusted place to:

- stay informed about the institute and the chapter,
- attend chapter events,
- find and contact fellow alumni,
- help each other with jobs, referrals, mentoring and personal help.

"Trusted" is the core of the product: only alumni verified by the chapter can see member details.

## 2. Users and roles

| Role | Who | Can do |
| --- | --- | --- |
| Visitor | Anyone with the link | See public home, upcoming events, institute updates, how to join. Sign in or register |
| Applicant | Registered, not yet verified | Edit own profile, RSVP to events, see verification status. Cannot see the directory or board |
| Member | Verified alumnus | Everything above, plus directory, contact details (subject to each person's privacy settings), post and respond on the board |
| Moderator | Member appointed by admin | Verify applicants, handle reported posts |
| Admin | Chapter committee | Everything, plus manage members and roles, events, announcements, institute updates, view the activity log |

Every chapter should have **at least two admins** so that verification never stops when one person is busy.

## 3. What the first version needed but did not have

The first prototype covered the six requests: institute updates, events, registration with
verification, the directory, profile fields and the jobs/help board. Running it for real also needs
the following. All items marked ✅ are now in prototype v2.

### Accounts and trust
- ✅ Sign in with mobile number and one-time code (OTP). No passwords to forget.
- ✅ Account states: applicant, verified, rejected (with a reason the person can see), suspended.
- ✅ Re-submit after rejection, so a typo in the roll number does not lock someone out.
- ✅ Vouching: an applicant can name a verified alumnus who knows them. This speeds up checks.
- ✅ Verification checklist for admins (roll number matches records, name matches proof, proof readable). Approve stays disabled until all three are ticked.
- ✅ "Ask for more information" in addition to approve and reject.
- ✅ Activity log of admin actions (who approved, rejected, suspended or removed what, and when).

### Privacy and consent
- ✅ Per-person visibility for phone and email: all verified members, only my batch, or only admins.
- ✅ Consent checkbox at registration explaining who will see the data.
- ✅ "Request account deletion" in settings.
- Not in prototype: written privacy policy and terms. India's Digital Personal Data Protection Act, 2023 applies to personal data collected digitally; the committee should get the policy text reviewed by someone qualified rather than rely on this document.

### Events
- ✅ RSVP with number of guests (families attend meets), capacity and seats left.
- ✅ Contribution / fee shown on the event.
- ✅ "Add to Google Calendar" link.
- ✅ Who's going, visible to verified members.
- Later: online payment of contributions (UPI), photo gallery after the event, check-in at the venue.

### Directory
- ✅ Quick filters: my batch, working in my district, mentors.
- ✅ "Where alumni work" summary by district, which also helps plan district-level meets.
- ✅ Full profile view with WhatsApp and LinkedIn links.
- Later: export to spreadsheet for admins, map view.

### Jobs & Help board
- ✅ Categories: vacancy, referral, help needed, offering help, mentorship.
- ✅ Every post expires (15, 30 or 60 days) so the board does not fill with dead vacancies.
- ✅ Author can mark a post filled or closed.
- ✅ "I'm interested" button; the author sees who responded.
- ✅ Report a post (spam, paid placement, wrong information, inappropriate). Moderators hide or dismiss.
- ✅ Posting rules shown in the composer (no fees, no paid placements, keep personal data minimal).

### Communication
- ✅ In-app notification centre: verification result, new events, responses to your posts, new vacancies in your state.
- ✅ Notification preferences (WhatsApp, email; topics).
- ✅ Chapter announcements, separate from institute updates, with pinning.
- Later: actual WhatsApp and email delivery (needs a WhatsApp Business API provider and an email provider).

### Profile quality
- ✅ Profile completeness meter listing what is missing.
- ✅ Extra fields: email, LinkedIn, skills/expertise, "open to mentoring".
- ✅ Admin overview shows profiles not updated in 12 months, so the committee can nudge people.

### Administration
- ✅ Admin area with tabs: overview, verify, members, reports, content, activity log.
- ✅ Make or remove moderators; suspend or reinstate members.
- ✅ Add institute updates by hand (see 6.3 for why).

## 4. Phased plan

| Phase | Scope | Outcome |
| --- | --- | --- |
| 0. Prototype (done) | Clickable UI with sample data | Committee agrees on screens and rules |
| 1. MVP web app | OTP login, registration + verification, profiles with privacy, directory, events with RSVP, board with expiry and reports, announcements, manual institute updates, admin area, activity log | Chapter can onboard members and run the next meet |
| 2. Phone app | Install as an app (PWA), then publish to Play Store; WhatsApp/email notifications | Members get reminders without opening the site |
| 3. Growth | Payments for event contributions, photo gallery, mentoring matching, data export, automatic institute updates if feasible, Hindi interface | Less manual work for the committee |

**Assumption:** Android first. Most members in Bihar are likely on Android; iOS can follow from the same code.

## 5. Recommended technical approach

**Assumption:** reuse the stack already in this repository's `backend/` so the same people can
maintain both projects.

| Part | Choice | Why |
| --- | --- | --- |
| API | Node.js 20+, TypeScript, Fastify, Zod | Same as `backend/` |
| Database | PostgreSQL with Drizzle ORM | Same as `backend/`; relational data with clear rules |
| Login | Phone + OTP, short-lived access token + refresh token | `backend/src/modules/auth/` already implements OTP with rate limits and hashed codes |
| Files (photos, proofs) | Object storage (S3-compatible). Proof documents in a **private** bucket, served only to admins through short-lived signed links | Proofs contain sensitive data |
| Images | Resize and compress profile photos on upload (for example to 512 px) | Keeps the directory fast on mobile data |
| Web app | React + TypeScript, built as a PWA | Works on any phone browser, installable |
| Android/iOS | Wrap the same web app with Capacitor | One codebase; Play Store presence |
| Messages | WhatsApp Business API provider for OTP and alerts, SMS fallback, email provider | Members already use WhatsApp |
| Hosting | Any managed Postgres + container host; daily database backups kept for 30 days | Small, predictable cost |

### 5.1 Data model (main tables)

- `users`: phone (unique), name, email, photo_url, roll_no, degree, branch, batch, position, organisation, home_district, home_state, work_district, work_state, linkedin, skills, open_to_mentor, phone_visibility, email_visibility, status (`applicant`, `verified`, `rejected`, `suspended`), role (`member`, `moderator`, `admin`), reject_reason, verified_by, verified_at, updated_at
- `verification_requests`: user_id, proof_file, vouched_by, checklist, decision, decided_by, notes
- `events`, `event_rsvps` (event_id, user_id, guests)
- `posts` (type, title, body, organisation, district, state, apply_link, status, expires_at, author_id), `post_interests`, `post_reports`
- `announcements`, `institute_updates` (title, category, url, published_on, source = `manual` or `website`)
- `notifications` (user_id, text, link, read_at), `notification_preferences`
- `audit_log` (actor_id, action, target, created_at)

### 5.2 Rules the server must enforce (not just the UI)

- Directory, board and contact details are returned only to verified, non-suspended users.
- Phone and email are removed from API responses according to the owner's visibility setting.
- Applicants and suspended users cannot post.
- Posts past `expires_at` are hidden from the board automatically.
- Only admins change roles or suspend; only staff verify or handle reports; every such action writes to `audit_log`.
- Rate limits on OTP requests, posting and reporting.
- Proof documents are deleted (or moved to cold storage) a fixed period after a decision. **Assumption:** 90 days.

## 6. Operations

### 6.1 Verification procedure
1. Applicant submits roll number, batch, branch, degree and a proof (degree, provisional certificate or institute ID).
2. A moderator ticks the checklist. If someone vouched, the moderator may confirm with that person.
3. Target: decision within 2 working days. The applicant gets a notification either way.
4. A rejection always includes a reason and allows re-submission.

Best option if the institute or the central alumni association can share a batch list: match roll numbers against it automatically.

### 6.2 Moderation
- Reported posts are reviewed within 2 days.
- Remove: fee-charging job offers, paid placement agencies, promotions unrelated to members, personal data of third parties.
- Repeat offenders are suspended by an admin; the reason is recorded in the activity log.

### 6.3 Institute updates
Pulling news automatically from www.nita.ac.in depends on how that website publishes notices
(an RSS feed, a stable HTML page, or PDFs). This has **not** been checked: the website could not be
reached from the environment where this spec was written. Plan:
1. Phase 1: an admin adds updates by hand with a link to the original notice (available in the prototype).
2. Phase 3: if the site has a stable notices page, a scheduled job reads it daily and adds new items as `source = website`. If the page layout changes, the job fails safely and admins are alerted.

### 6.4 Measures of success
- Verified members, and the share of applicants decided within 2 days
- Profiles complete and updated in the last 12 months
- RSVPs per event, and actual attendance
- Board posts per month, and the share marked filled
- Reports per month, and time to resolve them

## 7. Open questions for the committee

1. Should the app live in its own repository? It currently sits in the Aawaz CRM repository.
2. Is a batch list available from the institute or the central alumni association for automatic matching?
3. Who are the first admins and moderators?
4. Are event contributions collected online, at the venue, or both?
5. Is the chapter only for alumni in Bihar, or for anyone from Bihar wherever they work?
6. Should the app be offered in Hindi from the start?
