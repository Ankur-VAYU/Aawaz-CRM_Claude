# NIT Agartala Alumni — Patna Chapter

Web and mobile app for NIT Agartala alumni in Bihar.

## UI prototype

[`ui-prototype/index.html`](ui-prototype/index.html) is a clickable, single-file prototype. Open it in a
browser; no build step. It uses **sample data** saved in the browser's local storage
("Reset sample data" in the sidebar restores it). Nothing is sent to a server.

The layout is responsive: a sidebar on desktop and a bottom tab bar on phones, so the same
screens can be wrapped as an Android/iOS app later.

| Screen | What it covers |
| --- | --- |
| Home | Next alumni meet with RSVP, headline numbers, updates from NIT Agartala, latest board posts |
| Events | Upcoming and past events; admins can add events |
| Alumni | Directory of verified alumni, filtered by name/company, branch, batch, working state and district. Phone numbers are shown only to verified members |
| Jobs & Help | Vacancies, referrals and help requests, filtered by type and state |
| My profile | Edit name, photo, number, batch, branch, degree, current position and organisation, home district/state, work district/state |
| Registration | New alumnus fills the profile plus roll number and a proof document; the request goes to the admin |
| Verify (admin) | Approve or reject pending registrations; approved alumni appear in the directory |

Use the **Alumnus / Admin** switch to see both roles.

## Not built yet

- Backend (accounts, login, storage, file uploads, admin roles)
- Pulling updates from www.nita.ac.in (the headlines in the prototype are placeholders)
- Native app packaging
