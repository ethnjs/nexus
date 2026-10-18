---
paths:
  - "backend/app/**/discord/**"
  - "backend/app/models/discord.py"
  - "backend/app/schemas/discord.py"
  - "backend/app/api/routes/oauth.py"
  - "backend/tests/**/*discord*"
  - "backend/tests/discord_fake.py"
  - "frontend/app/dashboard/tournaments/**/settings/discord/**"
  - "frontend/app/connect/discord/**"
  - "frontend/components/tournament/settings/DiscordBuildModal.tsx"
---

# Discord

Read `backend/docs/discord.md` before changing how lobot links, builds, or syncs servers. Update it in the same PR when behavior changes.

Invariants that are easy to break:

- **NEXUS is the source of truth.** Discord code writes only the `discord_*` tables and Discord `oauth_identities` rows. No command or button changes NEXUS data.
- **The sync never changes configuration** (role permissions, tiers, order, channel names, categories, managed overwrites). That's `/reset`, behind a preview.
- **Marks go in the same transaction as the change, before any cascade deletes the rows that say who was affected.** A new NEXUS write path that changes assignments, roles, events, or memberships needs a mark (`core/discord/marks.py`). Where the commit maps `IntegrityError` to 409, mark inside the `try`.
- **Async code reaches the database only through `asyncio.to_thread`.**
- `app/services/discord/` never imports `app.models`.
- Never log interaction tokens, OAuth codes, or access tokens.
- Tests never reach Discord: use `mock_discord_rest` and `mock_discord_http`; the real REST client refuses every call under pytest.
- Users see the bot as **lobot**, lowercase, everywhere. Code comments and log lines may say "the bot".
- `DISCORD_DEV_GUILD_ID` is dev only; production registers commands globally.
