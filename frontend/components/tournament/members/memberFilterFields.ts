import type { FilterOptionGroup, FilterOptionItem, MemberFilterOptions } from "@/lib/api";
import type { FilterField } from "@/lib/filters/model";
import { YEAR_LEVEL_FILTER_OPTIONS } from "@/lib/personDisplay";

const TRACK_STATUS_OPTIONS: FilterOptionItem[] = [
  { value: "interested", label: "Interested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "declined", label: "Declined" },
];

const ONBOARDING_OPTIONS: FilterOptionItem[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
];

const ALL = ["any_of", "none_of", "empty", "not_empty"] as const;
const PICK = ["any_of", "none_of"] as const;
// For what a member can hold several of at once: every one of them.
const MANY = ["any_of", "all_of", "none_of", "empty", "not_empty"] as const;

/** The roster's filter fields (see ROSTER_FIELD_OPS in member_filters.py),
 *  leaving out any this tournament has nothing to offer for. The roster
 *  filters on the server, so none of them read rows. */
export function memberFilterFields(
  options: MemberFilterOptions | null,
  roles: FilterOptionItem[],
): FilterField[] {
  const tracks = options?.tracks ?? [];
  // One track is a simple tournament: "which track" has one answer, so the
  // per-track fields drop the picker.
  const byTrack = { groupLabel: "Which track", hideSingleGroup: tracks.length <= 1 };
  const perTrack = (choices: FilterOptionItem[]): FilterOptionGroup[] =>
    tracks.map((track) => ({ ...track, options: choices }));
  // Under is a known flag, not a missing one: "none of 18+" would also let
  // in everyone whose age is unknown.
  const age: FilterOptionItem[] = [
    ...(options?.collect_is_over_18
      ? [
          { value: "over_18", label: "18+" },
          { value: "under_18", label: "Under 18" },
        ]
      : []),
    ...(options?.collect_is_over_21
      ? [
          { value: "over_21", label: "21+" },
          { value: "under_21", label: "Under 21" },
        ]
      : []),
  ];

  const fields: (FilterField | false)[] = [
    {
      key: "role",
      label: "Role",
      section: "Membership",
      ops: MANY,
      control: "chips",
      options: roles,
      // A role can be held on some tracks only.
      scopes: tracks.length > 1 ? tracks : undefined,
      opLabels: {
        all_of: "holds all of",
        empty: "holds no role",
        not_empty: "holds any role",
      },
    },
    tracks.length > 0 && {
      key: "track",
      label: "Track status",
      section: "Membership",
      ops: ALL,
      control: "buttons",
      groups: perTrack(TRACK_STATUS_OPTIONS),
      ...byTrack,
      opLabels: { empty: "has no status", not_empty: "has a status" },
    },
    tracks.length > 0 && {
      key: "assigned",
      label: "Assignment",
      section: "Membership",
      // Assigned at all first: "who's unassigned on Day 1" is the usual ask.
      ops: ["empty", "not_empty", "any_of", "all_of", "none_of"],
      control: "chips",
      groups: options?.assignments,
      ...byTrack,
      opLabels: {
        empty: "is unassigned",
        not_empty: "is assigned",
        any_of: "is on any of",
        all_of: "is on all of",
        none_of: "is on none of",
      },
    },
    (options?.shift_days.length ?? 0) > 0 && {
      key: "shift",
      label: "Availability",
      section: "Membership",
      ops: ALL,
      groups: options?.shift_days,
      ...byTrack,
      opLabels: { empty: "has no availability", not_empty: "has some availability" },
    },
    Boolean(options?.has_onboarding) && {
      key: "onboarding",
      label: "Onboarding",
      section: "Membership",
      ops: PICK,
      control: "buttons",
      options: ONBOARDING_OPTIONS,
    },
    age.length > 0 && {
      key: "age",
      label: "Age",
      section: "Membership",
      ops: PICK,
      control: "buttons",
      options: age,
    },
    (options?.lunch_categories.length ?? 0) > 0 && {
      key: "lunch",
      label: "Lunch",
      section: "Responses",
      ops: ALL,
      groups: options?.lunch_categories,
      groupLabel: "Which question",
      opLabels: { empty: "is not answered", not_empty: "is answered" },
    },
    (options?.event_preferences.length ?? 0) > 0 && {
      key: "event_pref",
      label: "Event preferences",
      section: "Responses",
      ops: ALL,
      groups: options?.event_preferences,
      rank: true,
      ...byTrack,
      opLabels: { any_of: "ranked any of", none_of: "ranked none of" },
    },
    {
      key: "affiliation",
      label: "Affiliation",
      section: "Profile",
      ops: ALL,
      options: options?.affiliations ?? [],
    },
    {
      key: "year_level",
      label: "Year level",
      section: "Profile",
      ops: PICK,
      options: YEAR_LEVEL_FILTER_OPTIONS,
    },
    {
      key: "competition_event",
      label: "Competition experience",
      section: "Profile",
      ops: MANY,
      opLabels: { all_of: "has all of" },
      options: options?.competition_events ?? [],
    },
    {
      key: "volunteer_event",
      label: "Volunteer experience",
      section: "Profile",
      ops: MANY,
      opLabels: { all_of: "has all of" },
      options: options?.volunteer_events ?? [],
    },
  ];
  return fields.filter((field): field is FilterField => field !== false);
}
