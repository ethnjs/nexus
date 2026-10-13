# Audit log conventions

The tournament audit log records who did what, to what, and when. Actions are defined in `app/core/tournament/audit.py` and written with `log_action()`.

## Writing an entry

- **`action`** is snake_case `{noun}_{past_participle}` (`role_created`, `join_code_deactivated`). Define it as a constant in `audit.py`; never pass an inline string.
- **`target_type`** is the singular snake_case name of the affected model (`"role"`, `"track"`, `"tournament"`).
- **`target_id`** is the affected row's id. Leave it `None` when the action touches several rows, and list them in `extra_data` instead.
- **`extra_data`** is a dict of whatever the action name and target don't already say, or `None` when there's nothing to add.
- `log_action()` never commits. Call it before the route's own `db.commit()`, so the entry is written in the same transaction as the action.

Adding an action means adding it to `ALL_ACTIONS` in `audit.py`, and to `ALL_AUDIT_ACTIONS`, `ACTION_LABELS` and `DESCRIBERS` in `frontend/lib/auditLog.tsx`. The two lists are kept in sync by hand.

## `extra_data` by action

Shapes differ between actions, and sometimes between variants of one action. Check this table rather than copying a neighboring action.

| action | `extra_data` |
|---|---|
| `role_created` | `{"label": str, "rank": int, "permissions": [str]}` |
| `role_updated` (single role) | `{"changes": [{"field": str, "old": any, "new": any}]}`. A `permissions` change is recorded as `{"field": "permissions", "added": [str], "removed": [str]}` instead. |
| `role_updated` (bulk reorder) | `{"bulk_reorder": {"before": [{"role_id": int, "label": str, "rank": int}], "after": [...]}}`. Both sides list every role in the tournament, so unmoved roles anchor the diff. Logged only when a rank changed, and with no `target_id`. Older entries used `{"bulk_reorder": [{"role_id", "label", "old", "new"}]}`, listing changed roles only. |
| `role_deleted` | `{"label": str, "rank": int, "members_affected": int}` |
| `join_code_created` | `{"code": str, "label": str \| null, "expires_in_hours": int \| null, "expires_at": str \| null}` |
| `join_code_updated` | Any of `{"changes": {"label": {"old", "new"}}, "add_hours": int, "expires_at": {"old", "new"}}`, only for what changed |
| `join_code_deactivated` | `{"code": str}` |
| `staff_invite_sent` | `{"emails": [str], "join_code": str, "failed": [str]}`. `failed` is left out entirely when nothing failed. |
| `tournament_verified` | `{"is_verified": bool}` |
| `tournament_archived` | `None` when archived by hand. The daily auto-archive job logs `{"auto_archived": true}`. |
| `tournament_unarchived` | `None` |
| `ownership_transferred` | `{"old": {"id": int \| null, "name": str}, "new": {"id": int, "name": str}}` |
| `track_delete_pending` | `{"name": str, "blocked_by": [str]}` when shifts, events or form fields still point at the track. A track with no blockers is deleted at once and logs `{"name": str, "blocked_by": [], "purged_immediately": true}`. |
| `track_delete_cancelled` | `{"name": str}` |
| `track_purged` | `{"name": str, "member_rows_deleted": int}`. Logged when the last blocker on a pending track is removed, as a side effect of that edit. |
| `form_response_deleted` | `{"form_id": str, "form_name": str, "respondent_name": str}`, with `target_type="membership"`. Chapter forms aren't logged because chapters have no audit log. |
