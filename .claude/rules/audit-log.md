---
paths:
  - "backend/app/core/tournament/audit.py"
  - "backend/app/api/routes/tournament/audit.py"
  - "frontend/lib/auditLog.tsx"
  - "frontend/app/dashboard/tournaments/**/settings/audit-log/**"
---

# Audit log

`backend/docs/audit-log-conventions.md` defines naming and every action's `extra_data` shape. Update its table when you add or change an action.

- Actions are `{noun}_{past_participle}` constants in `audit.py`, never inline strings.
- `log_action()` doesn't commit. Call it before the route's `db.commit()`.
- `extra_data` shapes vary by action and variant, so follow the table rather than a neighboring action.
- A new action goes in `ALL_ACTIONS` (backend) and in `ALL_AUDIT_ACTIONS`, `ACTION_LABELS` and `DESCRIBERS` in `frontend/lib/auditLog.tsx`. Nothing generates or checks these lists.
