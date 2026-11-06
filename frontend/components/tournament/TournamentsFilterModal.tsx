"use client";

import { DateRangePicker, type DateRangeShortcut } from "@/components/ui/DateRangePicker";
import {
  FilterModal,
  type FilterOption,
  type FilterSectionConfig,
  type FilterState,
  filterAllows,
} from "@/components/ui/FilterModal";
import {
  TOURNAMENT_DIVISIONS,
  TOURNAMENT_LEVELS,
  TOURNAMENT_STATES,
  type TournamentSummary,
} from "@/lib/api";
import { todayLocalDateString, toLocalDateString } from "@/lib/date";

export const TOURNAMENTS_FILTER_KEYS = ["status", "dates", "level", "division", "state"] as const;
type TournamentsFilterKey = (typeof TOURNAMENTS_FILTER_KEYS)[number];

export type TournamentsFilterState = FilterState<TournamentsFilterKey>;

// The date range's two ends, kept in the filter's set of values as
// "from:2027-02-01" and "to:2027-03-31" — either may be absent.
const FROM = "from:";
const TO = "to:";

function rangeEnd(selected: Set<string>, prefix: string): string {
  const value = [...selected].find((v) => v.startsWith(prefix));
  return value ? value.slice(prefix.length) : "";
}

function rangeValues(from: string, to: string): Set<string> {
  const next = new Set<string>();
  if (from) next.add(`${FROM}${from}`);
  if (to) next.add(`${TO}${to}`);
  return next;
}

function inMonths(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return toLocalDateString(d);
}

/** September through June: the Science Olympiad season the given number of
 *  seasons back from the current one. */
function season(back: number): [string, string] {
  const now = new Date();
  // Before September, the season under way started the previous year.
  const start = now.getFullYear() - (now.getMonth() < 8 ? 1 : 0) - back;
  return [`${start}-09-01`, `${start + 1}-06-30`];
}

const DATE_SHORTCUTS: DateRangeShortcut[] = [
  {
    label: "Next 30 days",
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return [todayLocalDateString(), toLocalDateString(d)];
    },
  },
  { label: "Next 3 months", range: () => [todayLocalDateString(), inMonths(3)] },
  { label: "This season", range: () => season(0) },
  { label: "Last season", range: () => season(1) },
];

const STATUS_OPTIONS: FilterOption[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const LEVEL_OPTIONS: FilterOption[] = TOURNAMENT_LEVELS.map((level) => ({
  value: level,
  label: level[0].toUpperCase() + level.slice(1),
}));

const DIVISION_OPTIONS: FilterOption[] = TOURNAMENT_DIVISIONS.map((division) => ({
  value: division,
  label: `Division ${division}`,
}));

const STATE_OPTIONS: FilterOption[] = TOURNAMENT_STATES.map((state) => ({
  value: state,
  label: state,
}));

export function tournamentPassesFilters(
  // The dashboard's summaries and the admin table's rows both carry these.
  tournament: Pick<TournamentSummary, "is_archived" | "level" | "state" | "division" | "dates">,
  filters: TournamentsFilterState,
): boolean {
  if (!filterAllows(filters.status, tournament.is_archived ? "archived" : "active")) return false;
  if (!filterAllows(filters.level, tournament.level)) return false;
  if (!filterAllows(filters.state, tournament.state)) return false;
  // A tournament runs several divisions; any one of them picked is a match.
  if (filters.division.size > 0 && !tournament.division.some((d) => filters.division.has(d)))
    return false;
  if (filters.dates.size > 0) {
    // Any of its days in range, so a two-weekend tournament matches either
    // weekend. ISO dates compare as text; a TBD one has no days to match.
    const from = rangeEnd(filters.dates, FROM);
    const to = rangeEnd(filters.dates, TO);
    if (!tournament.dates.some((day) => (!from || day >= from) && (!to || day <= to))) return false;
  }
  return true;
}

export function TournamentsFilterModal({
  withStatus = false,
  filters,
  onApply,
  onClose,
}: {
  /** Offer Active / Archived — off where the page already splits them (the
   *  dashboard's sections). */
  withStatus?: boolean;
  filters: TournamentsFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: TournamentsFilterState) => void;
  onClose: () => void;
}) {
  const sections: FilterSectionConfig<TournamentsFilterKey>[] = [
    {
      key: "status",
      title: "Status",
      options: STATUS_OPTIONS,
      control: "buttons",
      hidden: !withStatus,
    },
    {
      key: "dates",
      title: "Dates",
      control: "custom",
      clearable: false,
      render: (selected, onChange) => {
        const from = rangeEnd(selected, FROM);
        const to = rangeEnd(selected, TO);
        return (
          <DateRangePicker
            aria-label="Tournament dates"
            openEnds
            from={from}
            to={to}
            onChange={(nextFrom, nextTo) => onChange(rangeValues(nextFrom, nextTo))}
            shortcuts={DATE_SHORTCUTS}
          />
        );
      },
    },
    { key: "level", title: "Level", options: LEVEL_OPTIONS, control: "buttons" },
    { key: "division", title: "Division", options: DIVISION_OPTIONS, control: "divisions" },
    {
      key: "state",
      title: "State",
      options: STATE_OPTIONS,
      control: "chips",
      searchable: true,
    },
  ];
  return (
    <FilterModal
      title="Filter tournaments"
      sections={sections}
      filters={filters}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
