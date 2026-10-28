# Onboarding and prerequisites

How NEXUS decides which tournament forms a member sees, and which onboarding steps they owe. Prerequisites live in `core/tournament/form_prerequisites.py`, onboarding paths in `core/tournament/onboarding.py`, and the manager's preview in `core/tournament/form_flow.py`.

## Prerequisites

`TournamentForm.prerequisites` is a list of role conditions, and a member must pass every one: `{"roles": [{"ids": [1, 2], "match": "any", "inverse": false}]}`. A condition holds when the member has any (or all) of `ids`; `inverse` flips it, so any + inverse means "holds none of them". Roles are track-blind here, like permissions: a role held on any track counts.

`meets_prerequisites` is the one evaluator. The member's form list (`GET /forms/me/`), the render and submit gate (`require_form_view_access`), onboarding paths and the flow preview all call it, so they can't disagree. Malformed JSON fails closed.

Managers with `manage_forms` skip the check. For everyone else, the gate on a published standard form runs whether or not they've answered it, so a member who loses a required role can no longer open their response. An archived form they answered stays readable.

Onboarding forms take prerequisites too. A step a member fails is left off their path rather than blocking them.

## A member's onboarding path

The tournament's steps are the `TournamentForm` rows with `is_onboarding`, in `order`. A step is on a member's path when they pass its prerequisites and it is either published, or archived and they answered it before it was archived.

- **Drafts are skipped.** A draft can be added to the sequence without un-onboarding anyone; publishing it is the change that counts.
- **An archived step they never answered is dropped**, since it can no longer be answered. One they did answer stays, so their progress keeps showing it as done.

The next required step is the first published, unanswered step on the path. While one exists the member is held to onboarding: other forms wait, and `require_form_view_access` sends them back to the sequence. Anyone holding a tournament permission is exempt, and so is everyone in an archived tournament.

The roster's onboarding ring and step list count the member's own path, so two members can show different totals.

## `onboarded_at` is a snapshot

Nothing gates on `TournamentMembership.onboarded_at`; every gate reads the path live. The timestamp is kept close by two writers:

- `recompute_onboarding` re-derives it for the whole tournament whenever the sequence changes: a step added, removed or changing status, or a response to a step deleted.
- `advance_onboarding_progress`, which the client calls after each submission, corrects it in both directions.

Role changes don't recompute it. A member whose new role adds a step keeps a stale `onboarded_at` until their next progress call, but their gates and the roster are right immediately.

## Flow preview

`GET /tournaments/{id}/forms/flow/?membership_id=` (`manage_forms`) returns what one member would see: every onboarding step, drafts included, with `applies` marking the ones on their path, and every other form with `applies` marking the ones their roles pass. `held_to_onboarding` says whether they still owe a published step.

The Form flow modal lists members through the prerequisites preview route with no conditions, because the roster route needs `manage_members` and the preview should work for a TD who only manages forms.
