import type { AdminUserListItem, FilterOptionItem } from "@/lib/api";
import type { FilterField } from "@/lib/filters/model";
import {
  userAffiliation,
  YEAR_LEVEL_FILTER_OPTIONS,
  yearLevelFilterValue,
} from "@/lib/personDisplay";

const ROLE_OPTIONS: FilterOptionItem[] = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
];

const STATUS_OPTIONS: FilterOptionItem[] = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "deactivated", label: "Deactivated" },
  { value: "locked", label: "Locked" },
];

const VERIFIED_OPTIONS: FilterOptionItem[] = [
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Not verified" },
];

const PROFILE_OPTIONS: FilterOptionItem[] = [
  { value: "complete", label: "Complete" },
  { value: "incomplete", label: "Incomplete" },
];

/** A tournament in the picker: `subtitle` is its owner and dates, since two
 *  tournaments can share a name. */
export interface TournamentFilterOption extends FilterOptionItem {
  subtitle: string;
}

const affiliationKey = (user: AdminUserListItem) =>
  userAffiliation(user, true)?.trim().toLowerCase();

/** The affiliations people have, as the column shows them. A school and an
 *  employer spelled the same are one option, as on the members table. */
export function affiliationOptions(users: AdminUserListItem[]): FilterOptionItem[] {
  const byKey = new Map<string, string>();
  for (const user of users) {
    const affiliation = userAffiliation(user, true)?.trim();
    if (affiliation && !byKey.has(affiliation.toLowerCase()))
      byKey.set(affiliation.toLowerCase(), affiliation);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, label]) => ({ value: key, label }));
}

/** The admin users table's filter fields, matched in the browser. Keys are
 *  the ones USER_SURFACES["admin_users"] accepts. */
export function adminUserFilterFields(
  affiliations: FilterOptionItem[],
  tournaments: TournamentFilterOption[],
): FilterField<AdminUserListItem>[] {
  return [
    {
      key: "role",
      label: "Role",
      section: "Account",
      ops: ["any_of", "none_of"],
      control: "buttons",
      options: ROLE_OPTIONS,
      rowValues: (user) => [user.role],
    },
    {
      key: "status",
      label: "Status",
      section: "Account",
      ops: ["any_of", "none_of"],
      control: "buttons",
      options: STATUS_OPTIONS,
      rowValues: (user) => [user.status],
    },
    {
      key: "verified",
      label: "Email",
      section: "Account",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: VERIFIED_OPTIONS,
      rowValues: (user) => [user.email_verified ? "verified" : "unverified"],
    },
    {
      key: "profile",
      label: "Profile",
      section: "Account",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: PROFILE_OPTIONS,
      rowValues: (user) => [user.is_profile_complete ? "complete" : "incomplete"],
    },
    {
      key: "tournament",
      label: "Tournament",
      section: "Account",
      ops: ["any_of", "all_of", "none_of", "empty", "not_empty"],
      control: "chips",
      searchable: true,
      options: tournaments,
      opLabels: {
        any_of: "is in any of",
        all_of: "is in all of",
        none_of: "is in none of",
        empty: "is in no tournament",
        not_empty: "is in a tournament",
      },
      rowValues: (user) => user.tournament_ids.map(String),
    },
    {
      key: "affiliation",
      label: "Affiliation",
      section: "Profile",
      ops: ["any_of", "none_of", "empty", "not_empty"],
      control: "chips",
      options: affiliations,
      rowValues: (user) => {
        const key = affiliationKey(user);
        return key ? [key] : [];
      },
    },
    {
      key: "year_level",
      label: "Year level",
      section: "Profile",
      ops: ["any_of", "none_of", "empty", "not_empty"],
      control: "buttons",
      options: YEAR_LEVEL_FILTER_OPTIONS,
      rowValues: (user) => {
        const level = yearLevelFilterValue(user);
        return level ? [level] : [];
      },
    },
  ];
}
