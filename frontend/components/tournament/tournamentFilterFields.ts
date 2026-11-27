import {
  type FilterOptionItem,
  TOURNAMENT_DIVISIONS,
  TOURNAMENT_LEVELS,
  TOURNAMENT_STATES,
  type TournamentSummary,
} from "@/lib/api";
import type { FilterField } from "@/lib/filters/model";
import { formatSeason } from "@/lib/tournamentDisplay";

/** What the dashboard's summaries and the admin table's rows both carry. */
type TournamentRow = Pick<
  TournamentSummary,
  "is_archived" | "level" | "state" | "division" | "dates" | "season_year"
>;

const STATUS_OPTIONS: FilterOptionItem[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const LEVEL_OPTIONS: FilterOptionItem[] = TOURNAMENT_LEVELS.map((level) => ({
  value: level,
  label: level[0].toUpperCase() + level.slice(1),
}));

const DIVISION_OPTIONS: FilterOptionItem[] = TOURNAMENT_DIVISIONS.map((division) => ({
  value: division,
  label: `Division ${division}`,
}));

const STATE_OPTIONS: FilterOptionItem[] = TOURNAMENT_STATES.map((state) => ({
  value: state,
  label: state,
}));

/** The seasons the given tournaments fall in, newest first. */
export function seasonsOf(tournaments: Pick<TournamentSummary, "season_year">[]): number[] {
  return [
    ...new Set(tournaments.flatMap((t) => (t.season_year === null ? [] : [t.season_year]))),
  ].sort((a, b) => b - a);
}

/** The tournaments lists' filter fields, matched in the browser. */
export function tournamentFilterFields(
  seasons: number[],
  { withStatus = false }: { withStatus?: boolean } = {},
): FilterField<TournamentRow>[] {
  const fields: (FilterField<TournamentRow> | false)[] = [
    // Off where the page already splits active from archived (the dashboard).
    withStatus && {
      key: "status",
      label: "Status",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: STATUS_OPTIONS,
      rowValues: (t) => [t.is_archived ? "archived" : "active"],
    },
    // Any of its days, so a two-weekend tournament matches either weekend; a
    // TBD one has no days to match.
    {
      key: "dates",
      label: "Dates",
      kind: "date",
      ops: ["within_next", "within_last", "after", "before"],
      rowValues: (t) => t.dates,
    },
    seasons.length > 0 && {
      key: "season",
      label: "Season",
      ops: ["any_of", "none_of"],
      control: "buttons",
      options: seasons.map((year) => ({ value: String(year), label: formatSeason(year) })),
      rowValues: (t) => (t.season_year === null ? [] : [String(t.season_year)]),
    },
    {
      key: "level",
      label: "Level",
      ops: ["any_of", "none_of"],
      control: "buttons",
      options: LEVEL_OPTIONS,
      rowValues: (t) => [t.level],
    },
    // A tournament runs several divisions; any one picked is a match.
    {
      key: "division",
      label: "Division",
      ops: ["any_of", "all_of", "none_of"],
      control: "divisions",
      options: DIVISION_OPTIONS,
      rowValues: (t) => t.division,
    },
    {
      key: "state",
      label: "State",
      ops: ["any_of", "none_of"],
      control: "chips",
      searchable: true,
      options: STATE_OPTIONS,
      rowValues: (t) => (t.state ? [t.state] : []),
    },
  ];
  return fields.filter((field): field is FilterField<TournamentRow> => field !== false);
}
