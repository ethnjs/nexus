# Track status rules

A member's status on a track is one of `interested`, `confirmed`, `declined` —
plus the synthetic `pending`, which is not stored. `pending` is what
`build_track_statuses` pads in for a track the member has no row for at all,
so a coordinator can tell "hasn't answered" apart from "this track doesn't
exist". It is never accepted on a write.

Two writers reach these rows, and they follow **different** rules. That is the
whole point of this document: the difference is deliberate, and collapsing the
two would break one of them.

---

## Writer 1 — form write-through (`can_set_track_status`)

Applies when a form response sets a status, via a `track_status_{suffix}`
question or an `availability_{track}` question that opted in with
`config.track_status_enabled`.

**The whole rule: a track never falls back to `interested` once it has moved
past it.** Everything else is permitted — `interested → confirmed`, either →
`declined`, `declined → confirmed` for someone who changes their mind, and any
status rewritten as itself.

This is what keeps statuses ordered, in place of comparing submission times.
Write-through runs forward, but a TD can raise a pending update on a track
question in an *older* form, and that patch would otherwise demote a track a
newer form already confirmed. Since the only damage an out-of-order write can
do is a demotion, refusing demotions closes the hole without any notion of
"which response is newer".

The cost is that no form can walk a mistaken `confirmed` back down to
`interested`. That needs a path which bypasses this guard — which is the next
writer.

A write the rule refuses is **skipped silently**, not raised. It is a
legitimate outcome of the rules — a respondent answering what they were asked
— rather than a client error worth failing a whole submission over.

---

## Writer 2 — the member, on their own page (`_set_track_status`)

Applies to `PUT /members/me/track-statuses/{track_id}/` and to the `status`
field on `PUT /members/me/availability/{track_id}/`.

| status | allowed when |
|---|---|
| `declined` | **always** — opting out is the member's own call, on any track |
| `confirmed` | only when the track's `allow_confirm` is on |
| `interested` | only when `allow_confirm` is **off** |

The reasoning behind each:

- **`declined` is unconditional.** A volunteer withdrawing is information the
  TD needs, and nothing about a track can make it not their decision.

- **`confirmed` needs `allow_confirm`.** On most tracks `confirmed` means *the
  TD staffed them*, and only the TD knows when that is true. `allow_confirm`
  is the TD saying "on this track, confirming yourself is the same thing".

- **`interested` requires `allow_confirm` to be off**, which reads backwards
  until you see what it is for: it is the way back in for a member who cannot
  confirm themselves. With self-confirm *on*, `declined → confirmed` is
  available directly and the middle state would be a step to nowhere, so it is
  rejected rather than silently allowed.

**Coming back from `declined` is exactly what write-through refuses**, and
that is the intended difference. That guard exists to stop a *stale form write*
from demoting a track a newer form already advanced. A member acting on their
own page is neither stale nor out of order — and without this exception, a
mistaken "Not available" click would be a one-way door.

An archived (pending-delete) track rejects both writers with a 409. The rows
are about to be cascaded away; inviting an answer would be inviting the member
to act on something that is already leaving.

---

## Where this lives

| | |
|---|---|
| the monotonic rule | `app/core/form/write_through.py` — `can_set_track_status` |
| the self-service rule | `app/api/routes/tournament/memberships.py` — `_set_track_status` |
| `pending` padding | `app/core/tournament/memberships.py` — `build_track_statuses` |
| the `allow_confirm` flag | `TournamentTrack.allow_confirm`, surfaced on `MembershipTrackStatusRead` so the member page can tell whether to offer a Confirm control at all |
