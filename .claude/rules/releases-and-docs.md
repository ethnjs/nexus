---
paths:
  - "docs/**"
  - ".github/**"
  - ".releaserc.json"
  - "backend/VERSION"
  - "CONTRIBUTING.md"
  - "README.md"
  - "backend/docs/**"
---

# Releases, docs and PRs

## Releases

- semantic-release computes versions from commit types. Never bump `backend/VERSION` or `frontend/package.json` by hand.
- Releases are cut manually (`gh workflow run release.yml`), never on merge. Tags are `v<x.y.z>-beta`. CONTRIBUTING.md has the dry-run command that previews the next tag.
- No `CHANGELOG.md` is kept; the GitHub release lists the commits.
- Release notes in `docs/release-notes/<tag>.mdx` are hand-written for TDs and volunteers in plain language, with no commit hashes or file paths. Start from `.github/RELEASE_NOTES_TEMPLATE.mdx`. Never generate them from the commit list.

## `docs/` (public)

- Synced to the docs site under `/nexus` on every push to `main` that touches it, and at each release.
- Every `.md` or `.mdx` file becomes a public page. Private notes go in `docs/temp/`, which is gitignored.
- Images go next to their page; videos go in `docs/public/`.
- Release-note frontmatter has `title` (the tag), `description`, and `date` (ISO 8601 with a UTC offset).

## Developer docs

`backend/docs/` holds design notes for subsystems that are hard to infer from code. Keep each note's facts in one place and link instead of repeating them across notes, so a behavior change updates one file. Write one line per paragraph or bullet, with no hard wraps. When a code change makes a note wrong, update the note in the same PR.

## PR descriptions

Follow `.github/pull_request_template.md`:

- Summary, then What changed (backend before frontend), Out of scope, and Test plan.
- One line per bullet, with no hard-wrapped lines.
- Describe migrations by their effect on data, with the revision hash in trailing parens. Start any bullet that drops rows or columns with **Destroys data:**.
- Delete empty sections rather than writing "N/A".
