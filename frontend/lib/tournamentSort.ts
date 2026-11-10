import type { SortFieldOption } from "@/components/ui/SortModal";
import type { TournamentSummary } from "@/lib/api";
import type { SortRule, SortValue } from "@/lib/sorting";

// The dashboard's summaries and the admin table's rows both carry these.
type Sortable = Pick<TournamentSummary, "id" | "name" | "dates">;

export type TournamentSortField = "date" | "name";

/** Direction labels say what the order is — see EVENT_SORT_OPTIONS. */
export const TOURNAMENT_SORT_OPTIONS: SortFieldOption[] = [
  { value: "date", label: "Date", ascLabel: "Soonest first", descLabel: "Latest first" },
  { value: "name", label: "Name", ascLabel: "A → Z", descLabel: "Z → A" },
];

export const DEFAULT_TOURNAMENT_SORT: SortRule<TournamentSortField>[] = [
  { field: "date", direction: "asc" },
];

/** What the chain falls back to, and the sentence the modal prints. */
export const TOURNAMENT_SORT_TIEBREAK = "name";

export function tournamentSortValue(tournament: Sortable, field: TournamentSortField): SortValue {
  switch (field) {
    // The first day, as ISO text. No dates yet (TBD) is null, which sorts
    // last both ways.
    case "date":
      return tournament.dates[0] ?? null;
    case "name":
      return tournament.name;
  }
}

/** The hidden tail every chain ends with, so the order is total: name, then id. */
export function tournamentSortTiebreak(a: Sortable, b: Sortable): number {
  const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return byName !== 0 ? byName : a.id - b.id;
}
