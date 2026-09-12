<!--
Title: same Conventional Commits format as the squash commit — `type(scope): summary`.
Add `!` for breaking changes (`feat(api)!: ...`).

One rule for everything below: ONE LINE PER BULLET. If a bullet needs a second
sentence, it's two changes — split it, or it belongs in the Summary. Lead with the
thing that changed, not the story of why. Rationale only when the change looks wrong
without it, and then one clause.

Any section past ~8 bullets gets grouped: `####` subheadings under Frontend, bold
lead-in labels inside an existing `####`. A flat list of 20 bullets is as unreadable
as the paragraph it replaced.
-->

## Summary

<!-- What this does and why, in 1-3 sentences. Plain language. If the PR has more than
one theme, one short numbered line each — no paragraphs. -->

Closes #

## What changed

### Backend

#### Models and migrations
<!-- What changes shape, in plain terms. Lead with the change, not the revision — put the
hash in trailing parens so it's greppable without being the first thing read. Lead any
bullet that loses data with **Destroys data:**. Delete the callout if there's no migration. -->

> `alembic upgrade head` required — N revisions.

- Adds `<column>` to `<table>`. (`abc123def456`)
-

#### Schemas and routes
<!-- New/changed/removed endpoints and response schemas. Mark breaking ones. -->
-

#### Logic
<!-- Behavior that isn't a route or a column: validation, permissions, services, jobs. -->
-

### Frontend
<!-- Pages, components, state. Note new shared components others should now reuse.
Past ~8 bullets, split into `####` groups by feature area (and a last one for shared UI)
rather than one long list. -->
-

## Out of scope
<!-- Anything the linked issue implied that this PR deliberately doesn't do. Delete if none. -->
-

## Test plan

- [ ] `pytest` passes locally
- [ ] Migration included for every model change
- [ ] Clicked through the UI change in a browser

**Automated**
<!-- New and meaningfully extended test files, one line each. -->
-

**Manual**
<!-- What you actually clicked, and what you expected to see. One line per check. -->
-
