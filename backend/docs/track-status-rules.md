# Track status rules

A member's status on a track is `interested`, `confirmed` or `declined`, stored as one `TournamentMembershipTrackStatus` row per (membership, track). Reads also show a synthetic `pending` for a track with no row (`build_track_statuses`), so coordinators can tell "hasn't answered" from "doesn't apply". `pending` is never accepted on a write.

Two writers change these rows, and **their rules differ on purpose**. Collapsing them into one would break one of them.

## Form write-through

Applies when a form response sets a status, through a `track_status_{suffix}` question or an `availability_{track}` question with `track_status_enabled`. Rows are only ever upserted, never deleted.

**The rule: `confirmed` never falls back to `interested`** (`can_set_track_status`).

| stored → incoming | `interested` | `confirmed` | `declined` |
|---|---|---|---|
| none | ✓ | ✓ | ✓ |
| `interested` | ✓ | ✓ | ✓ |
| `confirmed` | ✗ | ✓ | ✓ |
| `declined` | ✓ | ✓ | ✓ |

This keeps statuses ordered without comparing submission times. With response edits on, a member can patch a track question on an *older* form, which could otherwise demote a track a newer form already confirmed. A demotion is the only damage an out-of-order write can do, so refusing it closes the hole.

`declined` is deliberately not a floor. A member who opts out on their own page and later tells a form they're interested is giving newer information, and treating the opt-out as final made that form silently do nothing.

A refused write is **skipped silently**, not raised. It's a legitimate outcome of the rules, not a client error worth failing a submission over.

The cost is that no form can walk a mistaken `confirmed` back to `interested`. The second writer can.

## The member's own page

Applies to `PUT /tournaments/{id}/members/me/track-statuses/{track_id}/` and the `status` field of `PUT /tournaments/{id}/members/me/availability/{track_id}/` (`_set_track_status`).

Two gates come first, for every self-service write on the track (availability, lunch and event preferences as well as status):

- **The track isn't locked** (`lock_responses`, checked by `require_track_unlocked`). This includes declining.
- **The member has already answered** (`require_track_answered`): a status row must exist, and only form write-through creates one. The first answer always goes through a form, where the questions have context, so `pending` is never a starting point here.

When both fail, the lock is reported, since answering the form wouldn't help. A track pending deletion returns 409.

| Status | Allowed when |
|---|---|
| `declined` | always |
| `confirmed` | the track's `allow_confirm` is on |
| `interested` | the track's `allow_confirm` is off |

- **Declining is always allowed.** Withdrawing is the volunteer's call and information the TD needs.
- **Confirming needs `allow_confirm`.** On most tracks `confirmed` means the TD staffed them. `allow_confirm` is the TD saying self-confirming means the same thing on this track.
- **`interested` needs `allow_confirm` off.** It's the way back in for a member who can't confirm themselves. With self-confirm on, `declined → confirmed` is available directly, so the middle state is rejected.

**Walking `confirmed` back to `interested` is allowed here** (when `allow_confirm` is off), which is exactly what write-through refuses. That guard stops stale form writes; a member acting on their own page is neither stale nor out of order, and without this a mistaken "Not available" click would be a one-way door.

## Where this lives

| Rule | Code |
|---|---|
| Write-through transition rule | `app/core/form/write_through.py`: `can_set_track_status`, `sync_track_statuses` |
| Self-service rule | `app/api/routes/tournament/memberships.py`: `_set_track_status` |
| Lock and first-answer gates | `app/core/tournament/tracks.py`: `require_track_unlocked`, `require_track_answered` |
| `pending` padding | `app/core/tournament/memberships.py`: `build_track_statuses` |
| `allow_confirm` | `TournamentTrack.allow_confirm`, exposed on `MembershipTrackStatusRead` so the member page knows whether to offer Confirm |
