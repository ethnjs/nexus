# Audit log conventions

Pulled from `backend/app/core/tournament/audit.py` and every `log_action()`
call site — ground truth, not aspirational.

## Naming

- `action`: snake_case, `{noun}_{past-participle}` (e.g. `role_created`,
  `join_code_deactivated`, `staff_invite_sent`). Always a named constant in
  `audit.py`, never an inline string literal at the call site.
- `target_type`: singular snake_case noun matching the primary model the
  action affects — `"role"`, `"join_code"`, `"tournament"`.

## `target_id`

- Set to the specific row's id when the action affects **one** row.
- Omitted (`None`) when the action affects **multiple** rows at once — the
  bulk role-reorder route logs one entry with `target_type="role"` and no
  `target_id`, listing every affected role inside `extra_data` instead.

## `extra_data`

- A dict, included whenever there's something worth recording beyond the
  target itself.
- Can be omitted (`None`) entirely when the action name alone is
  self-explanatory — `tournament_archived`/`tournament_unarchived` log with
  no `extra_data` at all.
- `log_action()` never commits itself — every call site invokes it before
  the route's own `db.commit()`, so the log entry lands in the same
  transaction as the action it describes.

## `extra_data` shapes by action

| action | extra_data |
|---|---|
| `role_created` | `{"label": str, "rank": int, "permissions": [str]}` |
| `role_updated` (single-role `PATCH`) | `{"changes": [{"field": str, "old": any, "new": any}, ...]}` — a **list**. `permissions` changes are special-cased to `{"field": "permissions", "added": [str], "removed": [str]}` instead of raw old/new arrays. |
| `role_updated` (bulk reorder, `PATCH .../reorder-bulk/`) | `{"bulk_reorder": {"before": [{"role_id": int, "label": str, "rank": int}, ...], "after": [...same...]}}` — **a different shape under the same action name.** Full snapshot of *every* role in the tournament (rank-ordered) on both sides, not just the moved ones, so unmoved roles act as anchors in the rendered diff. Logged only when at least one rank actually changed. No `target_id` on this variant. Entries written before this change use the legacy delta shape: `bulk_reorder` as a **list** of `{"role_id", "label", "old", "new"}` for changed roles only. |
| `role_deleted` | `{"label": str, "rank": int, "members_affected": int}` |
| `join_code_created` | `{"code": str, "label": str \| null, "expires_in_hours": int \| null, "expires_at": str \| null}` |
| `join_code_updated` | `{"changes": {"label": {"old","new"}}, "add_hours": int, "expires_at": {"old","new"}}` — present only for whichever fields changed. |
| `join_code_deactivated` | `{"code": str}` |
| `staff_invite_sent` | `{"emails": [str], "join_code": str, "failed": [str]}` — `failed` key **omitted entirely** when nothing failed, not present-as-empty. |
| `tournament_verified` | `{"is_verified": bool}` |
| `tournament_archived` | none (`extra_data=None`) — except the daily auto-archive job, which logs `{"auto_archived": true}` to distinguish itself from a manual archive. |
| `tournament_unarchived` | none (`extra_data=None`) |
| `ownership_transferred` | `{"old": {"id": int, "name": str}, "new": {"id": int, "name": str}}` |

