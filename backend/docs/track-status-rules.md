# Track status rules

A member's status on a track is `interested`, `confirmed` or `declined`, stored as one `TournamentMembershipTrackStatus` row per (membership, track). Reads also show a synthetic `pending` for a track with no row (`build_track_statuses`), so coordinators can tell "hasn't answered" from "doesn't apply". `pending` is never accepted on a write.

## Form write-through

Forms are the only writer. A status is set through a `track_status_{suffix}` question or an `availability_{track}` question with `track_status_enabled`. Rows are only ever upserted, never deleted.

**The rule: `confirmed` never falls back to `interested`** (`can_set_track_status`).

| stored → incoming | `interested` | `confirmed` | `declined` |
|---|---|---|---|
| none | ✓ | ✓ | ✓ |
| `interested` | ✓ | ✓ | ✓ |
| `confirmed` | ✗ | ✓ | ✓ |
| `declined` | ✓ | ✓ | ✓ |

This keeps statuses ordered without comparing submission times. With response edits on, a member can patch a track question on an *older* form, which could otherwise demote a track a newer form already confirmed. A demotion is the only damage an out-of-order write can do, so refusing it closes the hole.

`declined` is deliberately not a floor. A member who declined on one form and later tells another they're interested is giving newer information, and treating the opt-out as final would make that form silently do nothing.

A refused write is **skipped silently**, not raised. It's a legitimate outcome of the rules, not a client error worth failing a submission over.

The cost is that nothing can walk a mistaken `confirmed` back to `interested`. A member can still decline through a form; anything else is a conversation with the TD.

## Where this lives

| Rule | Code |
|---|---|
| Transition rule | `app/core/form/write_through.py`: `can_set_track_status`, `sync_track_statuses` |
| `pending` padding | `app/core/tournament/memberships.py`: `build_track_statuses` |
