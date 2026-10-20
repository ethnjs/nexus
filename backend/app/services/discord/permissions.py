"""Discord permission bits NEXUS sets, and the sets it builds from them.
https://docs.discord.com/developers/topics/permissions"""

KICK_MEMBERS = 1 << 1
ADMINISTRATOR = 1 << 3
MANAGE_CHANNELS = 1 << 4
ADD_REACTIONS = 1 << 6
VIEW_AUDIT_LOG = 1 << 7
PRIORITY_SPEAKER = 1 << 8
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
MANAGE_MESSAGES = 1 << 13
READ_MESSAGE_HISTORY = 1 << 16
MENTION_EVERYONE = 1 << 17
MUTE_MEMBERS = 1 << 22
DEAFEN_MEMBERS = 1 << 23
MOVE_MEMBERS = 1 << 24
CHANGE_NICKNAME = 1 << 26
MANAGE_EVENTS = 1 << 33
MANAGE_THREADS = 1 << 34
CREATE_PUBLIC_THREADS = 1 << 35
CREATE_PRIVATE_THREADS = 1 << 36
SEND_MESSAGES_IN_THREADS = 1 << 38
MODERATE_MEMBERS = 1 << 40
CREATE_EVENTS = 1 << 44
PIN_MESSAGES = 1 << 51
BYPASS_SLOWMODE = 1 << 52

# Server-level permissions for roles with manage_discord but not manage_tournament. Left out on
# purpose: Administrator, Manage Server, Manage Roles and Manage Nicknames (staff can't fight the
# sync), Manage Webhooks (webhooks can impersonate anyone), Ban Members, and Manage Expressions.
STAFF_PERMISSIONS = (
    VIEW_CHANNEL
    | READ_MESSAGE_HISTORY
    | VIEW_AUDIT_LOG
    | MANAGE_CHANNELS
    | MANAGE_MESSAGES
    | PIN_MESSAGES
    | BYPASS_SLOWMODE
    | MENTION_EVERYONE
    | MANAGE_THREADS
    | CREATE_PUBLIC_THREADS
    | CREATE_PRIVATE_THREADS
    | SEND_MESSAGES_IN_THREADS
    | MODERATE_MEMBERS
    | KICK_MEMBERS
    | CREATE_EVENTS
    | MANAGE_EVENTS
    | MUTE_MEMBERS
    | DEAFEN_MEMBERS
    | MOVE_MEMBERS
    | PRIORITY_SPEAKER
)

# The one channel overwrite the bot adds for a staff role. Allow beats deny across roles, so it
# overrides @everyone's deny and any other role's.
STAFF_OVERWRITE = VIEW_CHANNEL | READ_MESSAGE_HISTORY

# Posting, threads included. The Information category denies it to @everyone and gives it to staff
# roles; members otherwise post through @everyone's server-level defaults.
POSTING = SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS

# Taken from @everyone at the server level by the first build and /reset. Verified gives back
# View Channels; nicknames are the sync's.
EVERYONE_REVOKED = {VIEW_CHANNEL: "View Channels", CHANGE_NICKNAME: "Change Nickname"}

VERIFY_EVERYONE_ALLOW = VIEW_CHANNEL | READ_MESSAGE_HISTORY
VERIFY_EVERYONE_DENY = (
    SEND_MESSAGES | ADD_REACTIONS | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS
)
