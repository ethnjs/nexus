"use client";

import {
  FilterModal, FilterOption, FilterSectionConfig, FilterState, filterAllows,
  filterStateFromStored, filterStateToStored,
} from "@/components/ui/FilterModal";
import { TournamentShift, TournamentTrack } from "@/lib/api";

// Mirrors KNOWN_SHIFT_FILTER_KEYS in display_config.py.
export const SHIFTS_FILTER_KEYS = ["track", "events"] as const;
type ShiftsFilterKey = (typeof SHIFTS_FILTER_KEYS)[number];

export type ShiftsFilterState = FilterState<ShiftsFilterKey>;

// A shift no event uses yet is the thing worth finding.
const EVENTS_OPTIONS: FilterOption[] = [
  { value: "has", label: "Has events" },
  { value: "none", label: "No events" },
];

/** Live competition days, which are the only tracks a shift sits on. */
export function shiftTrackOptions(tracks: TournamentTrack[]): FilterOption[] {
  return tracks.filter((t) => !t.is_archived).map((t) => ({ value: String(t.id), label: t.name }));
}

export function shiftPassesFilters(shift: TournamentShift, filters: ShiftsFilterState): boolean {
  if (!filterAllows(filters.track, String(shift.track_id))) return false;
  if (!filterAllows(filters.events, shift.event_count > 0 ? "has" : "none")) return false;
  return true;
}

export const shiftsFilterFromStored = (stored: Record<string, string[]> | null | undefined): ShiftsFilterState =>
  filterStateFromStored(SHIFTS_FILTER_KEYS, stored);

export const shiftsFilterToStored = (filters: ShiftsFilterState) => filterStateToStored(filters);

export function ShiftsFilterModal({ trackOptions, filters, onApply, onClose }: {
  trackOptions: FilterOption[];
  filters: ShiftsFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: ShiftsFilterState) => void;
  onClose: () => void;
}) {
  // A handful of days, so buttons; hidden with one day — every shift is on it.
  const sections: FilterSectionConfig<ShiftsFilterKey>[] = [
    { key: "track", title: "Track", options: trackOptions, control: "buttons", hidden: trackOptions.length < 2 },
    { key: "events", title: "Events", options: EVENTS_OPTIONS, control: "buttons" },
  ];
  return <FilterModal title="Filter shifts" sections={sections} filters={filters} onApply={onApply} onClose={onClose} />;
}
