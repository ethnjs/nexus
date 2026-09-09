// Mirrors app/core/tournament/display_config.py's KNOWN_SURFACES — kept in
// sync by hand since there's no shared codegen between the two.
export const MEMBERS_PANEL = "members_panel";
// The roster table. A separate surface from the panel: each has its own
// controls, and hiding a track from one shouldn't hide it from the other.
export const MEMBERS_TABLE = "members_table";
export const MEMBER_PAGE = "member_page";
// The assignments board's member card. Unlike the three above it ignores saved
// config — the card face is fixed (name, event prefs, experience), so passing
// it as `surface` is purely a request for that field set.
export const ASSIGNMENT_CARD = "assignment_card";
// The events table. Its own surface with its own column and filter
// vocabulary — an event and a member share no fields.
export const EVENTS_TABLE = "events_table";
