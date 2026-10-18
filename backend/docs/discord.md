# Discord integration

NEXUS links tournament Discord servers to tracks and keeps their roles and channels in step with NEXUS. The bot is called **lobot**, always lowercase, in everything users see. This note records how it works and why; the public user guide lives in `docs/`.

## Principles

- **NEXUS is the source of truth.** The Discord code writes only its own `discord_*` tables, plus `oauth_identities` when someone links an account. No slash command or button changes NEXUS data.
- **The bot is part of the backend.** There's no separate service: one deploy.
- **The bot never sends DMs, and never kicks or bans.** Users see ephemeral replies, the `#verify` message, and the NEXUS Discord settings page. Ineligible members are stripped back to the gate, never removed.
- **Sync keeps people and objects right; `/reset` keeps configuration right.** The automatic sync never changes how anything is configured, so it can run constantly without fighting admins. See "Sync versus reset".

## Moving parts

- **Interactions endpoint**, `POST /discord/interactions/`: Discord sends slash commands and button clicks here, straight to the backend's public URL, not through the Vercel proxy. It's registered without `api_key_dependency`; an async dependency verifies the Ed25519 signature over the raw body before parsing (Discord signs exact bytes, and it deliberately sends bad signatures, removing the endpoint if one is accepted). The route itself is a sync `def`.
- **Gateway connection**: one discord.py client keeps lobot online and receives server events. Only the leader process runs it.
- **REST**: every bot call goes through `DiscordRest` (`services/discord/rest.py`), built on discord.py's `HTTPClient`, which waits out rate limits and retries.
- **The leader** (`core/discord/leader.py`): every process tries `pg_try_advisory_lock` on its own connection, outside the request pool. The holder runs the gateway, the sync drain, the sweep, and APScheduler (so `archive_ended_tournaments` runs once, not once per worker). It checks its connection every 30 seconds and competes again if it drops. This covers uvicorn workers, Railway replicas, and rolling deploys; it would break under PgBouncer in transaction-pooling mode, which isn't in use. A moment with two leaders is harmless because every handler and reconcile is idempotent.

| Path | Contents |
|---|---|
| `app/api/routes/discord/` | `interactions.py` (the endpoint), `guilds.py` (install flow, per-track settings, build) |
| `app/api/routes/oauth.py` | Account-link start and callback, next to Google's |
| `app/services/discord/` | Discord protocol only: the gateway client, REST, OAuth, signatures, command definitions, permission bits. Never imports `app.models`. |
| `app/core/discord/` | NEXUS logic: `layout.py` (pure), `build.py`, `reconcile.py`, `drain.py`, `marks.py`, `eligibility.py`, `interactions.py`, `events.py`, `sweep.py`, `leader.py`, `links.py`, `previews.py` |
| `app/models/discord.py` | The Discord tables, imported from `app/models/__init__.py` so Alembic, `init_db`, and the tests always register them. Relationships point only from Discord models to NEXUS models. |

## Configuration and Discord applications

- **Feature switch:** Discord is on only when `DISCORD_BOT_TOKEN` is set and pytest isn't running (`discord_enabled()`). Off, the Discord routes return 404 and nothing connects. Preview deploys leave it off.
- **Settings:** `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `DISCORD_LINK_REDIRECT_URI`, `DISCORD_INSTALL_REDIRECT_URI`, `DISCORD_DEV_GUILD_ID`, and `OAUTH_STATE_SECRET` (shared with Google; production refuses the default).
- **`DISCORD_DEV_GUILD_ID` is dev only.** Set, slash commands register on that one server, where they update instantly; blank, they're global, which is what production needs. Set in production, the commands would exist in one server and nowhere else.
- **Applications:** production's is named `lobot` (the application name is the bot's name in servers); each developer makes their own, `lobot-dev`, with a test server. Applications belong to a Discord **Team** whose members all have 2FA: Discord blocks a bot's moderation actions, Administrator included, in servers requiring 2FA unless the owner has it.
- **Portal settings:** Server Members intent on (the client asks for it, and Discord refuses a connection asking for an intent the portal hasn't enabled; `GET /guilds/{id}/members` needs it too). Requires OAuth2 Code Grant on, so the bot can only be added through "Add to Discord". Public Bot on, so TDs can install it.
- **URLs:** both OAuth redirect URIs are frontend proxy URLs, so the session cookie stays first-party, registered without a trailing slash (Next.js redirects proxy paths ending in `/`; the proxy adds it back). The interactions URL points at the backend directly and keeps its trailing slash. Dev uses a stable tunnel (an ngrok account's free dev domain) for the interactions URL; CONTRIBUTING's "Discord dev setup" has the steps.

## Account linking

- Discord OAuth with scope `identify` links accounts; it never signs anyone in. The access token is used once, in the callback, and never stored. The link is an `oauth_identities` row with `provider='discord'` and the Discord user id in `provider_account_id`.
- One Discord account per NEXUS account and the reverse, both unique constraints. Relinking the account you already have succeeds and refreshes the stored username.
- `/connect/discord` is where lobot's link buttons point: it signs you in if needed, then goes straight to Discord.
- Unlinking (Settings → Security) needs no password, since Discord can't sign in.

## Servers and tracks

- **One server per track and one track per server** (`track_id` and `guild_id` are unique on `discord_guild_links`).
- **The server's owner must be a linked, active NEXUS user with `manage_tournament` in the tournament.** That matches what `manage_tournament` already means in Discord (Administrator). Anyone with `manage_discord` can run the install, and the server owner can differ from the installer. Ownership is checked only at install; later ownership changes don't unlink.
- **The install is a full OAuth code grant** with scopes `bot applications.commands identify` and `permissions=8` (Administrator). `identify` is there only because Discord includes the `guild` object in the token response only in a full code grant. The callback trusts that `guild` (with its `owner_id`), never the redirect's `guild_id`, which Discord documents as a hint.
- **Administrator** is needed because a bot can only set overwrite bits and role permissions it holds itself, and the build sets many. Role hierarchy still applies.
- **A refused install makes lobot leave at once,** inside the callback, before redirecting, so a quick retry finds lobot gone (otherwise Discord's next token response can lack `guild`, since the bot wasn't added). A failed leave falls back to a `leave:<guild_id>` notification to the leader. lobot never leaves a server another track is linked to.
- **Installing builds nothing**; nothing syncs until the first build.
- **Unlinking** deletes the link (and its managed-id maps and marks) and sends the leave notification in the same transaction. Roles and channels stay. Re-adding adopts them by name.
- **Servers with no link:** the 15-minute sweep makes lobot leave any it joined over an hour ago. The hour covers installs in progress. A queued leave is skipped if the server was linked again meanwhile.

| State | Behavior |
|---|---|
| Tournament archived | No sync; builds refused; commands reply "This tournament is archived." Unarchiving writes a full mark. |
| Track pending deletion | Same, "This track is being deleted." Cancelling the deletion writes a full mark. |
| Track purged | The link cascades away; the sweep makes lobot leave. |
| lobot removed from the server | `bot_removed_at` set, no sync; "Add to Discord" again clears it and writes a full mark. |

## Permissions and tiers

- `manage_discord` gates Add to Discord, the Discord settings, building, `/setup`, `/reset`, and `/sync`. The default template gives it to Tournament Director, Volunteer Coordinator, and Test Coordinator. In Discord, the linked NEXUS account must also be active (not deactivated or locked); `has_permission` doesn't check that, so the commands and Verify do.
- **Admin tier:** NEXUS roles with `manage_tournament` (and the Tournament Owner role) get Administrator in Discord.
- **Staff tier:** roles with `manage_discord` but not `manage_tournament` get the staff permission set (`STAFF_PERMISSIONS` in `services/discord/permissions.py`) and see every channel. Left out on purpose: Administrator, Manage Server, Manage Roles (staff can't hand-edit managed roles or channel permissions, so they can't fight the sync), Manage Webhooks (webhooks can impersonate anyone), Ban Members, and Manage Expressions.
- **A role's tier is stored** (`discord_managed_roles.tier`) as set at creation or the last `/reset`, and the sync reads that, not NEXUS's current permissions. Otherwise a role whose NEXUS permissions changed would gain access to new channels but not old ones. Permission and tier changes reach Discord only through `/reset`.

## Eligibility (the gate)

A Discord member is eligible in a server linked to track T when their account is linked to an **active** NEXUS user (not deactivated or locked) who either owns the tournament, or holds, through a membership whose age disclosure isn't declined, any assignment on T or any tournament-wide one. The tournament mustn't be archived and T mustn't be pending deletion. Bots are never touched, and site admins get no special treatment. `desired_role_keys` in `eligibility.py` computes this for a whole server in one batched query.

## Roles

| Role | Permissions | Holders |
|---|---|---|
| Tournament Owner | Administrator | The tournament's owner; follows ownership transfers |
| One per NEXUS role, named by its label | By tier | Holders on T or tournament-wide |
| One per event on T, `Circuit Lab C` | None | Event and event-plus-shift assignments on T; zone rows never give event roles |
| Verified | View Channels | Every eligible member |

- Built order, directly below lobot's own role and above any unmanaged roles below it: Tournament Owner, NEXUS roles by rank, event roles alphabetically, Verified. Later roles go where Discord puts them; only `/reset` reorders.
- New roles get no color. Admin-tier NEXUS roles are created hoisted (their own group in the member list). Color, hoist, icon, and mentionable are never reset.
- Member roles change one role per call (`PUT`/`DELETE …/members/{u}/roles/{r}`), never a full role-list `PATCH`, which would race admins' own role changes and has unclear behavior for Discord-managed roles.
- **Hierarchy:** Discord allows equal positions and ranks ties by id (lower id higher), so every hierarchy check ranks by (position, id). A managed role at or above lobot's is skipped: builds warn, scoped resets refuse, and the sync records a warning (`last_sync_warning`, shown in yellow, not as a failure) while syncing everything else. A brand-new server can report every role at one position; then no reorder is possible (Discord refuses positions at or above the bot's, and the bot can't move itself), so the build skips it and a `/reset` preview tells the admin to drag any role once.

## Channels

- **Gate:** at the first build `@everyone` loses View Channels; Verified grants it. `#verify` sits at the top: `@everyone` can read but not post, Verified is denied View (so verified members don't see it), and staff are allowed. lobot posts one message there with a Verify button and link buttons to `/connect/discord` and the volunteer guide in `docs/`.
- **Event channels:** one per event on T, named by slugging its name with division, trimmed to 100 characters. With division merge on, events sharing a catalog event and a building or zone (unplaced counts as one place) share a channel named from the catalog name plus the divisions run together, `#circuit-lab-bc`. Custom events never merge. Overwrites: `@everyone` denied, each covered event's role allowed, staff allowed.
- **Categories** come from buildings or zones per the link's grouping setting; unplaced events go in "Other Events", or "Events" if nothing on T is placed. Past 50 channels a category overflows into "Name (2)".
- **Identity is the set of event ids a channel covers** (its key, `event:12,13`); categories use `building:5`, `zone:3`, or `other`. Names are display only.
- **Staff visibility:** a staff role with no overwrite at all on a channel gets View plus Read History, on managed and unmanaged channels alike, the one thing lobot writes on channels it doesn't manage. An explicit deny hides a channel from staff and is left alone (a managed channel's deny is undone only by `/reset`). Removing the overwrite entirely counts as no choice, so the allow comes back. Allow beats deny across roles, so this works over `@everyone`'s deny.
- **Archived:** a channel whose events are all gone moves to an "Archived" category (created on first need) and stops being managed.

## Build, `/setup`, and `/reset`

- **One planner.** `build.py` reads both sides (NEXUS's layout from `layout.py`, the server's live state) and returns a list of actions. The preview describes that list and Confirm executes the same list, so the preview lists exactly what will happen. Action targets are keys, resolved when they run, so an action can use an object created earlier in the same run.
- **Resumable:** every Discord id is saved the moment its object exists, so a crashed or redeployed build resumes when run again.
- **Not reset** (first build and re-runs): create what's missing, adopt an unmanaged object only when exactly one matches by name, add back a managed role's missing overwrite on a managed channel, fill staff gaps, and set the gate on the first build. Existing managed objects otherwise stay as they are.
- **Reset:** additionally restores managed roles' permissions, tier, and order; managed channels' names, categories, order, and `@everyone`/managed-role overwrites (overwrites for unmanaged roles and members are kept); the gate; and the layout, so changed merge or grouping settings, buildings, or zones take effect, archiving channels whose keys left the layout. Topic, slowmode, colors, icons, and hoist are never touched.
- **Scoped reset** (`/reset role:` or `channel:`): only that object, never creating, archiving, or reordering. Unmanaged targets are refused, and a channel whose key left the layout points to a full reset.
- **Checks before anything changes:** lobot must hold Administrator, and the result must stay within 250 roles and 500 channels (categories count); either failing blocks Confirm.
- **Confirmation:** both entry points preview first. Confirm carries a signed token (`previews.py`, HMAC with `OAUTH_STATE_SECRET`, compact enough for a button's 100-character `custom_id`) naming the link, the build kind, and who asked; it expires after 10 minutes, and Confirm re-checks `manage_discord`. The Discord preview shows up to 10 items a heading, within Discord's 2,000-character limit, and links to the full list in NEXUS and to the staff guide's section on building or resetting.
- **One build per server, across processes:** `claim_build` sets `last_build_status='running'`; a running build refreshes `last_build_at` every 30 seconds, so one silent for 2 minutes is treated as interrupted and can be started again. The sync's structure step holds `sync_started_at` the same way, so a build and the sync never plan from the same snapshot (both would create a missing role): the sync waits while a build runs, and a build is refused while the sync is changing the server. Status and errors land on the link.

## Sync versus reset

| | Sync (automatic; `/sync` runs it now) | `/reset` (preview and Confirm) |
|---|---|---|
| Who holds which managed roles | Yes | Runs a sync afterwards |
| Missing managed roles, channels, categories, `#verify` and its message | Recreated | Yes |
| Managed role names | Renamed back | Yes |
| Roles whose NEXUS role or event is gone | Deleted | Yes |
| Channels whose events are all gone | Archived | Yes |
| Missing staff overwrites | Added | Yes |
| Role permissions, tier, order | No | Yes |
| Channel names, categories, grouping, and managed overwrites | No | Yes |
| Unmanaged-role and member overwrites, topics, slowmode, colors | Never | Never |

**`/setup` after the first build is not a reset.** It creates what's missing, adopts by name, and fills missing overwrites, but never changes anything that exists. Every build ends with a full mark, so whatever the sync reverts is reverted after `/setup` too.

What happens to a Discord admin's edits ("kept" means it's left as the admin set it):

| Admin edit in Discord | Sync | `/setup` | `/reset` |
|---|---|---|---|
| Adds or removes a managed role on a member, Verified included | Reverted | Reverted (its closing sync) | Reverted |
| Renames a managed role | Renamed back | Renamed back (its closing sync) | Renamed back |
| Deletes a managed role, channel, category, or `#verify` and its message | Recreated | Recreated | Recreated |
| Changes a managed role's permissions or position | Kept | Kept | Restored |
| Changes a managed role's color, hoist, icon, or mentionable | Kept | Kept | Kept |
| Renames or moves a managed channel, or edits its `@everyone` or managed-role overwrites | Kept | Kept | Restored |
| Denies a staff role View on a channel | Kept | Kept | Restored to allow on managed channels; kept on others |
| Removes a staff role, or Verified on `#verify`, from a channel's overwrites entirely | Re-added | Re-added | Restored |
| Gives `@everyone` View Channels at the server level | Kept | Kept | Removed again |
| Edits a managed channel's topic, slowmode, or other settings; adds overwrites for unmanaged roles or members | Kept | Kept | Kept |
| Creates or edits unmanaged roles or channels, assigns unmanaged roles, or edits an archived channel | Kept (a new channel gets the staff overwrite) | Kept | Kept |

Changing division merge or category grouping in NEXUS, or moving events between buildings or zones, changes Discord only on `/reset`.

**Between resets the sync never regroups channels.** An event that already has a channel keeps it even if the layout would group it differently, and only an event no managed channel covers gets a new one. An event joining a merged channel's group joins that channel and grows its key; one leaving shrinks it. A recreated category takes back only channels left without a category. The sync can't tell NEXUS's moves from an admin's, so re-categorizing automatically would fight admins; the reset preview is where layout changes are reviewed.

## Marks and the drain

- **Marks** (`discord_sync_marks`): `member` (one server, one Discord user), `structure` (roles, channels, staff overwrites), or `full` (structure plus every member). One row per (link, kind, user); writing again re-arms it and moves `created_at` forward.
- **Written in the same transaction as the NEXUS change**, with `pg_notify('discord_sync')`, by the helpers in `marks.py`. Cascades write no marks, so routes query affected members before deleting. In routes whose commit maps an `IntegrityError` to 409, the marking goes inside the `try`: its queries autoflush the write, which is where a duplicate fails.

| Write | Marks |
|---|---|
| Assignment create, update, delete, placements (one mark per member for the whole edit); zone assignments; role grants | member, in the row's track's server; tournament-wide rows in every server |
| Membership deleted (both routes) | member, every server |
| Role created or renamed | structure, every server |
| Role deleted; event deleted or removed from a track | structure, plus member for former holders, queried first |
| Event created or renamed, or its tracks change | structure, every server |
| Zone or shift deleted; track default-role reassign | member for the rows that cascade or move |
| Discord link and unlink; account deletion, deactivation, admin status change | member for the account in every server where the user counts (tracks they hold roles on, plus tournaments where they hold a tournament-wide role or are the owner), member lists never scanned |
| Ownership transferred | member, old and new owner, every server |
| Unarchive; track deletion cancelled; lobot added back | full |
| Buildings, zones, and permissions | Nothing; they matter only on `/reset` |

- **The drain** (`drain.py`, leader only) wakes on `LISTEN discord_sync`, acting on each notification as it arrives, or every 5 seconds. It claims due marks with `FOR UPDATE SKIP LOCKED` and a 10-minute lease, so a leader that dies mid-reconcile leaves them to be retried. Success deletes only marks created before the claim, so a change made during a reconcile is kept. Failure backs off exponentially up to an hour and records `last_sync_error`. A full mark settles the server's other marks.
- **Database work in async code always goes through `asyncio.to_thread`,** never on the event loop.
- **The sweep** writes a full mark for every syncing server every 15 minutes, which reverts hand edits to members' roles and catches anything missed. For a quiet 300-member server that's a handful of Discord calls and no writes.

## Gateway events

The client asks only for the `guilds` and `members` intents, with no member cache and no chunking, so messages, presence, and voice never arrive. Handlers write marks only:

| Event | Mark |
|---|---|
| Member joins (not a bot) | member, so a linked, eligible member is verified before clicking anything |
| Managed role deleted | full (recreate it, then give it back) |
| Managed channel or category deleted | structure |
| Channel created; a staff role's overwrite removed entirely | structure |
| Bot removed; server renamed | sets `bot_removed_at`; updates `guild_name` |

lobot sees its own changes too; repeated marks merge, so a build's channel creates add one no-op structure reconcile afterwards. The gateway is a convenience: the sweep and the Verify button cover anything missed during a deploy.

## Interactions

- Replies are ephemeral and work only in servers. Anything slower than Discord's 3 seconds is deferred and finished by editing the reply through the interaction token, which lasts 15 minutes and is never logged.
- **Commands** are registered by the leader at startup with a bulk overwrite, only when the definitions changed (Discord allows 200 creates per server per day). `/sync`, `/setup`, and `/reset` set `default_member_permissions` to Manage Channels to hide them from ordinary members; the NEXUS `manage_discord` check is the real gate.

| Command | Does |
|---|---|
| `/link` | A link button to `/connect/discord` |
| `/whoami` | Your linked NEXUS name, roles on this track and tournament-wide, and event assignments with shift times, counting only what eligibility counts (an inactive account or a declined age disclosure shows none) |
| `/sync` | Writes a full mark and replies with the last sync's failure or warning |
| `/setup` | Preview, Confirm, then `build(reset=False)` |
| `/reset [role] [channel]` | Preview, Confirm, then a full or scoped reset |

- **The Verify button** (`custom_id` `nexus:verify:<Verified role id>`): already holding Verified, per the click payload, is answered without a database query; then a 10-second per-worker cooldown; then unlinked (instructions and the link button), inactive account ("isn't active"), ineligible ("doesn't have a role or assignment in …", no kick), or eligible (a member mark, "You're verified").
- `/link` and `/whoami` work for unverified members in `#verify` because slash commands need Use Application Commands, which `@everyone` keeps and which is separate from Send Messages.

## Discord behavior this relies on

Checked on 2026-10-16 against Discord's developer docs and the discord.py 2.7.1 source. ⚠️ marks what Discord doesn't document.

- **Overwrites:** `@everyone`'s overwrite applies first, then all of a member's role overwrites combined (deny, then allow, so allow beats deny across roles), then the member's own. Administrator and the server owner skip overwrites entirely.
- **A bot can only allow or deny overwrite bits, and give role permissions, that it holds itself,** and can only assign, edit, or reorder roles below its own highest role.
- **Pin Messages (bit 51) and Bypass Slowmode (bit 52)** were split out of Manage Messages in August 2025, and pinning has required Pin Messages since February 2026, so the staff set lists both.
- **2FA:** Kick, Ban, Administrator, Manage Channels, Manage Messages, Manage Roles, Manage Webhooks, and Manage Threads require the bot's owner to have 2FA in servers with server-wide 2FA.
- **Limits:** 50 channels per category; channel names 1 to 100 characters. ⚠️ 250 roles and 500 channels per server come from error codes 30005 and 30013 as listed by discord.js, not from Discord's docs; roles from other integrations count toward the 250.
- **Bulk reorders:** `PATCH /guilds/{id}/roles` and `PATCH /guilds/{id}/channels` reorder many in one call, but at most one channel per call may change `parent_id`, so moves between categories are one call each.
- **Members list:** `GET /guilds/{id}/members` returns up to 1,000 per call and requires the Server Members intent in the portal, whatever the gateway asks for.
- **Interaction delivery:** with an endpoint URL set, interactions come only over HTTP, never the gateway. Tokens last 15 minutes, and edits through them don't count against the bot's global rate limit. ⚠️ Link buttons in ephemeral replies aren't documented, but work.
- **Global commands** update by read-repair: a stale command refreshes when someone runs it.
- **Install:** the token response carries `guild` only in a full code grant with a scope beyond `bot` and `applications.commands`. ⚠️ The docs don't say whether the bot joins at Authorize or at the code exchange; leaving in the callback and the sweep's one-hour grace cover both.
- **Gateway:** 1,000 identifies per 24 hours, resumes excluded. Closing with code 1000 or 1001 shows the bot offline at once; other disconnects leave it shown online until the session times out.
- **discord.py:** `Client.start()` installs no signal handlers or logging (only `run()` does), so it runs as a task on uvicorn's loop. With `MemberCacheFlags.none()` and chunking off, `on_member_join` still fires. Its HTTP client waits out 429s per bucket.

## Tests

- `tests/discord_fake.py` is an in-memory Discord server with `DiscordRest`'s interface, installed by the autouse `mock_discord_rest`; `mock_discord_http` stubs Discord's OAuth endpoints. As a backstop, `tests/conftest.py` makes the real REST client refuse every call for the whole session, so no test can reach Discord even after `monkeypatch.undo()`.
- `discord_on` turns the feature on with dev-shaped settings; `DISCORD_TEST_KEY` signs interaction requests.
- `layout.py` has pure unit tests; the build and sync tests run against real NEXUS data and the fake server.

## Deferred

Zone roles and zone channels (categorizing by zone is supported), nickname sync, the `guilds.join` scope, and an email when someone is removed from a tournament.
