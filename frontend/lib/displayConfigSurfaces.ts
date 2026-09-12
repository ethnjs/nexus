// Mirrors app/core/tournament/display_config.py's KNOWN_SURFACES — kept in
// sync by hand since there's no shared codegen between the two.
export const MEMBERS_PANEL = "members_panel";
// The roster table. A separate surface from the panel: each has its own
// controls, and hiding a track from one shouldn't hide it from the other.
export const MEMBERS_TABLE = "members_table";
export const MEMBER_PAGE = "member_page";
// The assignments board's member card. As a `surface` query param it is a
// request for a fixed field set (name, event prefs, experience) — the server
// narrows the payload the same way whatever is saved here. What it stores is
// purely client-side view state: which of those fields the card renders
// (`hidden`) and how the belt is filtered (`filters`).
export const ASSIGNMENT_CARD = "assignment_card";
// The events table. Its own surface with its own column and filter
// vocabulary — an event and a member share no fields.
export const EVENTS_TABLE = "events_table";
// The assignments board's event rows. Its own surface rather than a reuse of
// EVENTS_TABLE: a row shows a time range the table has no column for, and the
// two are filtered by their own controls — narrowing the board to staff a
// morning shouldn't rewrite how you last read the events page.
export const ASSIGNMENTS_EVENTS = "assignments_events";
