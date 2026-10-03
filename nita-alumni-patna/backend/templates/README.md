# Spreadsheet templates

Open these in Excel or Google Sheets, replace the example row with real data, and save as CSV.

| File | Used by | Required columns |
| --- | --- | --- |
| `members-import-template.csv` | `members:import` and `POST /api/v1/admin/members/import` | name, phone, degree, branch, batch, home_district |
| `batch-list-template.csv` | `batch:import` and `POST /api/v1/admin/batch-list` | roll_no, name, batch, branch, degree |

Notes:

- Column names are flexible. "Mobile number", "Batch (passing year)" or "Home district" work as
  well, so a Google Forms export can be imported as it is. Unknown columns such as "Timestamp" are
  ignored and listed in the result.
- `degree`, `branch`, `home_district` and `work_state` must match the lists in
  `src/lib/reference.ts`. Spelling and capitals are forgiven ("btech", "computer science and
  engineering", "siwan").
- `home_district` must be a district of Bihar.
- `status`: `verified` (default for imports) or `pending`. `role`: `member`, `moderator` or `admin`.
  `open_to_mentor`: yes or no. `phone_visibility` / `email_visibility`: `members`, `batch` or `admins`.
- Photos cannot be imported from a spreadsheet; members add them later.
