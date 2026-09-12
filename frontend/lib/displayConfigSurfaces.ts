// Mirrors app/core/tournament/display_config.py's KNOWN_SURFACES — kept in
// sync by hand since there's no shared codegen between the two.
export const MEMBERS_PANEL = "members_panel";
// The roster table. A separate surface from the panel: each has its own
// controls, and hiding a track from one shouldn't hide it from the other.
export const MEMBERS_TABLE = "members_table";
export const MEMBER_PAGE = "member_page";
export const ASSIGNMENT_CARD = "assignment_card";
