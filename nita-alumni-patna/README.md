# NIT Agartala Alumni — Patna Chapter

Web and mobile app for NIT Agartala alumni in Bihar.

| File | Contents |
| --- | --- |
| [`PRODUCT.md`](PRODUCT.md) | Product and technical spec: roles, features, phased plan, recommended stack, data model, server rules, operating procedures, open questions |
| [`ui-prototype/index.html`](ui-prototype/index.html) | Clickable prototype (v2). Open in a browser; no build step |

## UI prototype

The prototype uses **sample data** saved in the browser's local storage. Nothing is sent to a
server. "Reset sample data" in the sidebar restores the original data.

Use the **Demo: view as** menu to switch between a visitor, an applicant waiting for verification,
a member and an admin. To try sign-in, use mobile `98350 41276` and the code shown on screen, or a
new number to go through registration.

| Screen | What it covers |
| --- | --- |
| Home | Visitors: what the chapter is, how joining works, next event, institute updates, committee. Members: profile completeness, next event with RSVP, pinned announcements, numbers, institute updates, latest board posts |
| Sign in / Join | Mobile number + one-time code. New numbers go to registration: profile, roll number, proof upload, optional vouch from a verified alumnus, consent |
| Events | RSVP with guests, places left, contribution, add to Google Calendar, who's going. Admins add events |
| Alumni | Verified members only. Search, filters, quick filters (my batch, my district, mentors), "where alumni work" by district, full profile with WhatsApp and LinkedIn. Phone and email follow each person's privacy setting |
| Jobs & Help | Vacancy, referral, help needed, offering help, mentorship. Posts expire; authors mark them filled or closed and see who is interested; anyone can report a post |
| My profile | All profile fields, photo, completeness, privacy for phone and email, notification preferences, sign out, request deletion. Rejected applicants correct and resubmit here |
| Notifications | Bell with unread count: verification result, new events, responses to your posts, vacancies in your state |
| Admin | Overview, Verify (checklist, approve, ask for info, reject with reason), Reports, Members (roles, suspend), Content (announcements, events, institute updates), Activity log. Moderators see Verify and Reports only |

## Not built yet

See section 4 of [`PRODUCT.md`](PRODUCT.md). In short: the backend and real data, WhatsApp/email
delivery, file storage for photos and proofs, automatic import of institute updates (not yet
confirmed to be possible), payments, and Play Store packaging.
