# NIT Agartala Alumni — Patna Chapter

Web and mobile app for NIT Agartala alumni from Bihar, wherever they work.

| File | Contents |
| --- | --- |
| [`PRODUCT.md`](PRODUCT.md) | Product and technical spec: decisions, roles, eligibility, features, phased plan, recommended stack, data model, server rules, operating procedures, open questions |
| [`ui-prototype/index.html`](ui-prototype/index.html) | Clickable prototype (v4). Open in a browser; no build step |

## UI prototype

The prototype uses **sample data** saved in the browser's local storage. Nothing is sent to a
server, and payments are simulated. "Reset sample data" in the sidebar restores the original data.

Use the **Demo: view as** menu to switch between a visitor, an applicant waiting for verification,
a member and the admin (the chapter President). To try sign-in, use mobile `98350 41276` and the
code shown on screen, or a new number to go through registration.

| Screen | What it covers |
| --- | --- |
| Home | Visitors: what the chapter is, how joining works, next event, institute updates, committee. Members: profile completeness, next event, pinned announcements, members working in and outside Bihar, institute updates, latest board posts |
| Sign in / Join | Mobile number + one-time code. New numbers go to registration: profile, roll number, home district in Bihar, work place anywhere, optional proof and vouch, consent |
| Events | RSVP with guests, contribution per family or person, pay online or at the venue, places left, add to Google Calendar, who's going |
| Alumni | Verified members only. Search and filters including home district and work place, quick filters, "where they work" and "home districts" summaries, full profile with WhatsApp and LinkedIn. Contact details follow each person's privacy setting |
| Jobs & Help | Vacancy, referral, help needed, offering help, mentorship. Expiry, filled/closed, interest, reporting |
| My profile | All profile fields, photo, completeness, privacy, notification preferences, sign out, request deletion, resubmit after rejection |
| Admin | Overview, Verify (batch-list match and checklist), Reports, Events & payments, Batch list (CSV upload and lookup), Members (roles, committee titles, suspend), Content, Activity log |

## Not built yet

See section 6 of [`PRODUCT.md`](PRODUCT.md): the backend and real data, payment gateway,
WhatsApp/email delivery, file storage, automatic institute updates, and Play Store packaging.
