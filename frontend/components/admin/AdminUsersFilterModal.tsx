"use client";

import {
  FilterModal,
  type FilterOption,
  type FilterSectionConfig,
  type FilterState,
  filterAllows,
} from "@/components/ui/FilterModal";
import type { AdminUserFull } from "@/lib/api";
import {
  userAffiliation,
  YEAR_LEVEL_FILTER_OPTIONS,
  yearLevelFilterValue,
} from "@/lib/personDisplay";

export const ADMIN_USERS_FILTER_KEYS = [
  "role",
  "status",
  "verified",
  "affiliation",
  "year_level",
] as const;
type AdminUsersFilterKey = (typeof ADMIN_USERS_FILTER_KEYS)[number];

export type AdminUsersFilterState = FilterState<AdminUsersFilterKey>;

const ROLE_OPTIONS: FilterOption[] = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
];

const STATUS_OPTIONS: FilterOption[] = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "deactivated", label: "Deactivated" },
  { value: "locked", label: "Locked" },
];

const VERIFIED_OPTIONS: FilterOption[] = [
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Not verified" },
];

/** The affiliations people have, as the column shows them. A school and an
 *  employer spelled the same are one option, as on the members table. */
export function affiliationOptions(users: AdminUserFull[]): FilterOption[] {
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

export function userPassesFilters(user: AdminUserFull, filters: AdminUsersFilterState): boolean {
  if (!filterAllows(filters.role, user.role)) return false;
  if (!filterAllows(filters.status, user.status)) return false;
  if (!filterAllows(filters.verified, user.email_verified ? "verified" : "unverified"))
    return false;
  const affiliation = userAffiliation(user, true)?.trim().toLowerCase();
  if (filters.affiliation.size > 0 && !(affiliation && filters.affiliation.has(affiliation)))
    return false;
  const yearLevel = yearLevelFilterValue(user);
  if (filters.year_level.size > 0 && !(yearLevel && filters.year_level.has(yearLevel)))
    return false;
  return true;
}

export function AdminUsersFilterModal({
  affiliations,
  filters,
  onApply,
  onClose,
}: {
  affiliations: FilterOption[];
  filters: AdminUsersFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: AdminUsersFilterState) => void;
  onClose: () => void;
}) {
  const sections: FilterSectionConfig<AdminUsersFilterKey>[] = [
    { key: "role", title: "Role", options: ROLE_OPTIONS, control: "buttons" },
    { key: "status", title: "Status", options: STATUS_OPTIONS, control: "buttons" },
    { key: "verified", title: "Email", options: VERIFIED_OPTIONS, control: "buttons" },
    {
      key: "affiliation",
      title: "Affiliation",
      options: affiliations,
      control: "chips",
      searchable: true,
    },
    {
      key: "year_level",
      title: "Year level",
      options: YEAR_LEVEL_FILTER_OPTIONS,
      control: "buttons",
    },
  ];
  return (
    <FilterModal
      title="Filter users"
      sections={sections}
      filters={filters}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
