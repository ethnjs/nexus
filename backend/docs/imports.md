# Imports

An import brings a tournament's existing volunteer data (a Google Form's responses, or any CSV or XLSX) into NEXUS as responses to an **import form**. Code: `app/api/routes/form_imports.py`, `app/core/form/imports.py`, `import_sources.py`, `import_mapping.py`, `import_inference.py`, and `app/services/google_import.py`.

## Import forms

- An import form is a `Form` with `kind="import"`. Only imports fill it: it's never published, submitting or editing a response returns 409, and it can't join onboarding or have prerequisites (422).
- It has a `TournamentForm` row like any tournament form, so a member who was imported sees their response as completed and read-only. Everyone else gets a 404.
- Its questions can't be required or branch, since a row is stored whatever it leaves blank. A `track_status_*` question is the one place this lifts a rule: elsewhere it must be required.
- `Form.import_source` (`ImportSource`) says where rows come from (an upload's file type, or a Google Sheet's id and tab), whether a Google Form supplied the questions, and the identity columns.
- `FormField.import_mapping` (`ImportMapping`) says how a question reads the source. Shapes are listed on the schema in `app/schemas/form_import.py`. A question with no mapping takes no data.
- Managers read and change these through `GET`/`PATCH /forms/{id}/import/` and `PUT /forms/{id}/fields/`. `GET /forms/{id}/` never includes them, so members don't see column headers or the spreadsheet id.

## Sources

- Rows are never stored. Each dry run or import reads the source again: a Google Sheet is fetched, and an upload is sent again.
- Uploads are multipart and capped at 4 MB, under Vercel's request limit, since they pass through the frontend's proxy. A source may have up to 5,000 rows and 200 columns.
- Blank headers become "Column C" and repeated ones "Phone (2)", so every column has a unique name for mappings to use.
- Google access is one service account with read-only Sheets and Forms scopes. A TD shares the sheet and form with its email (`GET /tournaments/{id}/imports/service-account/`). Credentials come from `GOOGLE_SERVICE_ACCOUNT_JSON`, or the file at `google_service_account_file` locally.
- A Google Form is read by its edit link; the respondent link's id is one the API can't open. The API exposes neither which tab holds the responses nor a grid's "limit to one response per column", so the TD picks the tab and sets that in the builder.

## Inference

- Creating an import form proposes its questions (`infer_fields`). With a Google Form, its questions come first, in its order, with their types and full option lists. Then every column the form didn't cover is guessed from its values: `Title [Row]` groups become grids, cells joined with ", " become checkboxes, a few repeated values become a dropdown, and the rest become text.
- Identity columns (email, name, phone, timestamp) are picked from the headers and never become questions.
- When a Google Form supplied the options, the builder locks their labels, because cells match option labels. Otherwise labels stay editable. Display cleanup goes in each option's `value`.

## Running an import

`POST /forms/{id}/import/` does a dry run by default. A dry run does every write and rolls them back, so its report is exactly what the real run would do.

- A cell matches an option's label, ignoring case and spacing. Unmatched text becomes the Other answer when there is one. A cell that can't be read drops only that answer (a grid only that row) and is reported.
- A row with no usable email is skipped. Among rows with the same email, the newest timestamp wins, a missing one counting as oldest.
- An active or invited account with the email is attached, and its `User` row is never changed. A deactivated or locked account is skipped. An email with no account gets an invited `User` with the row's name (a full name is split at the first space) and phone, and no password.
- New memberships have `source="import"` and no roles. Track statuses come only from the answers, through the same write-through as a submission, over the questions the import read.
- Re-importing replaces the responses of the people in the source and keeps everyone else's. `submitted_at` and each answer's `answered_at` are the row's timestamp, or the import time when it has none.
- The real run logs `form_imported` with the ids it created, so an import can be undone later.
- With `email_invited`, each created account gets an email asking its owner to sign up with that address. Signing up, or resetting the password, claims the invited account; see `find_claimable_user` in `app/core/users.py`.
- Imported answers show on members' records and exports like published forms' answers (`Form.answers_show_on_members`).
