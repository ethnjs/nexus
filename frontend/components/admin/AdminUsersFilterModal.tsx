"use client";

import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import {
  FilterModal,
  type FilterOption,
  type FilterSectionConfig,
  type FilterState,
  filterAllows,
  filterStateFromStored,
} from "@/components/ui/FilterModal";
import { IconPlus } from "@/components/ui/Icons";
import { pillStyle } from "@/components/ui/PillMenu";
import { Popover } from "@/components/ui/Popover";
import type { AdminUserListItem } from "@/lib/api";
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
  "tournament",
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
export function affiliationOptions(users: AdminUserListItem[]): FilterOption[] {
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

export function adminUsersFilterFromStored(
  stored: Record<string, string[]> | null | undefined,
): AdminUsersFilterState {
  return filterStateFromStored(ADMIN_USERS_FILTER_KEYS, stored);
}

// The tournament filter's values: "3" keeps people in tournament 3, "!3"
// keeps people not in it, and NO_TOURNAMENT keeps people in none at all.
const NO_TOURNAMENT = "none";
const EXCLUDE = "!";

function tournamentFilterAllows(selected: Set<string>, tournamentIds: number[]): boolean {
  const ids = new Set(tournamentIds.map(String));
  const included = [...selected].filter((v) => !v.startsWith(EXCLUDE));
  for (const value of selected) {
    if (value.startsWith(EXCLUDE) && ids.has(value.slice(EXCLUDE.length))) return false;
  }
  if (included.length === 0) return true;
  return included.some((v) => (v === NO_TOURNAMENT ? ids.size === 0 : ids.has(v)));
}

/** Chips for the tournaments being filtered on, each with a pill that flips
 *  it between keeping people in that tournament and keeping people out. */
/** A tournament in the picker: `subtitle` is its owner and dates, shown
 *  under the row and in the chip's tooltip. */
export interface TournamentFilterOption extends FilterOption {
  subtitle: string;
}

function TournamentFilterBody({
  tournaments,
  selected,
  onChange,
}: {
  tournaments: TournamentFilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const byId = new Map(tournaments.map((o) => [o.value, o]));
  const idOf = (value: string) => (value.startsWith(EXCLUDE) ? value.slice(EXCLUDE.length) : value);
  // Keyed by value, not label: two tournaments can share a name.
  const chosen = [...selected].filter((v) => v === NO_TOURNAMENT || byId.has(idOf(v)));
  const unchosen = tournaments.filter((o) => !chosen.some((value) => idOf(value) === o.value));

  function replace(from: string, to: string | null) {
    const next = new Set(selected);
    next.delete(from);
    if (to !== null) next.add(to);
    onChange(next);
  }

  return (
    <ChipInput
      value={chosen}
      onChange={(values) => {
        const removed = chosen.find((value) => !values.includes(value));
        if (removed) replace(removed, null);
      }}
      getChipLabel={(value) =>
        value === NO_TOURNAMENT ? "No tournaments" : (byId.get(idOf(value))?.label ?? value)
      }
      getChipTooltip={(value) => byId.get(idOf(value))?.subtitle}
      variant="transparent"
      size="sm"
      disableInput
      fullWidth
      emptyLabel="None"
      addButtonOnHover
      renderChipTrailing={(value) => {
        if (value === NO_TOURNAMENT) return null;
        const excluded = value.startsWith(EXCLUDE);
        return (
          <button
            type="button"
            title={excluded ? "Switch to in this tournament" : "Switch to not in this tournament"}
            onClick={() => replace(value, excluded ? idOf(value) : `${EXCLUDE}${value}`)}
            style={{ ...pillStyle(excluded ? "danger" : "default", "sm"), cursor: "pointer" }}
          >
            {excluded ? "Not in" : "In"}
          </button>
        );
      }}
      addButton={
        <Popover
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconOnly
              title="Filter by tournament"
              style={{ padding: 0, flexShrink: 0 }}
            >
              <IconPlus size={13} />
            </Button>
          }
          items={unchosen}
          getKey={(option) => option.value}
          renderLabel={(option) => option.label}
          getSubtitle={(option) => option.subtitle}
          getSearchText={(option) => `${option.label} ${option.subtitle}`}
          searchable
          onSelect={(option) => replace(option.value, option.value)}
          footerLabel={selected.has(NO_TOURNAMENT) ? undefined : "No tournaments"}
          onFooterClick={() => replace(NO_TOURNAMENT, NO_TOURNAMENT)}
          emptyMessage="All added"
          width={300}
          align="left"
        />
      }
    />
  );
}

export function userPassesFilters(
  user: AdminUserListItem,
  filters: AdminUsersFilterState,
): boolean {
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
  return tournamentFilterAllows(filters.tournament, user.tournament_ids);
}

export function AdminUsersFilterModal({
  affiliations,
  tournaments,
  filters,
  onApply,
  onClose,
}: {
  affiliations: FilterOption[];
  tournaments: TournamentFilterOption[];
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
    {
      key: "tournament",
      title: "Tournament",
      control: "custom",
      render: (selected, onChange) => (
        <TournamentFilterBody tournaments={tournaments} selected={selected} onChange={onChange} />
      ),
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
