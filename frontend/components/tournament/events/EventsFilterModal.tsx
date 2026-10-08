"use client";

import {
  FilterModal, FilterOption, FilterSectionConfig, FilterState, filterAllows, filterStateFromStored,
  filterStateToStored, isFilterActive,
} from "@/components/ui/FilterModal";
import { Assignment, TournamentEvent } from "@/lib/api";
import { staffedCount } from "@/lib/assignments/staffing";

// Shared by the events table and the assignments board — same keys, same
// meaning, same predicate (eventPassesFilters) on both.
export const EVENTS_FILTER_KEYS = [
  "division", "type", "category", "track", "building", "shifts", "shift", "staffing",
] as const;
type EventsFilterKey = (typeof EVENTS_FILTER_KEYS)[number];

export type EventsFilterState = FilterState<EventsFilterKey>;

// The filter value standing for "this event has no such thing" — no division,
// no category. A sentinel rather than "" because an empty selection already
// means "no narrowing", so the absence has to be a value you can pick.
export const EVENT_FILTER_UNSET = "__unset__";

/** An event's category as a filter value. An event with no catalog link has
 *  no category at all, which is a thing you can filter *for*. */
export function eventCategoryKey(event: TournamentEvent): string {
  return event.event?.category.name ?? EVENT_FILTER_UNSET;
}

/** The category section's options, derived from the loaded events rather than
 *  a catalog fetch: a category nothing uses is not worth a row, and the
 *  filtering is client-side over exactly these events anyway. */
export function eventCategoryOptions(events: TournamentEvent[]): FilterOption[] {
  const names = new Set(events.filter((e) => e.event).map((e) => e.event!.category.name));
  const options = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  return events.some((e) => !e.event)
    ? [...options, { value: EVENT_FILTER_UNSET, label: "No category" }]
    : options;
}

// Fixed two-value enum, shared wherever an event's type is filtered or
// displayed, so a third type never has to be added in two places at once.
export const EVENT_TYPE_OPTIONS: FilterOption[] = [
  { value: "standard", label: "Standard" },
  { value: "trial", label: "Trial" },
];

// Not a partition: an event passes if it matches *any* picked value, and
// "Nobody assigned" is a sharper cut of "Short" worth picking on its own.
const STAFFING_OPTIONS: FilterOption[] = [
  { value: "full", label: "Fully staffed" },
  { value: "short", label: "Short" },
  { value: "empty", label: "Nobody assigned" },
  { value: "no_needs", label: "No needs" },
];
const STAFFING_VALUES = new Set(STAFFING_OPTIONS.map((o) => o.value));

const SHIFTS_OPTIONS: FilterOption[] = [
  { value: "has", label: "Has shifts" },
  { value: "none", label: "No shifts" },
];

/** Tracks the loaded events run on, in first-seen (schedule) order. */
export function eventTrackOptions(events: TournamentEvent[]): FilterOption[] {
  const seen = new Map<number, string>();
  for (const e of events) for (const t of e.tracks) if (!seen.has(t.id)) seen.set(t.id, t.name);
  return [...seen].map(([id, name]) => ({ value: String(id), label: name }));
}

/** Buildings the loaded events use on any track, plus "No location" when a
 *  competition track is still missing one — the thing worth hunting for. */
export function eventBuildingOptions(events: TournamentEvent[]): FilterOption[] {
  const names = new Map<number, string>();
  let missing = false;
  for (const e of events) {
    for (const d of e.track_details) {
      if (d.building_id !== null) names.set(d.building_id, d.building_name ?? `Building ${d.building_id}`);
      else if (e.tracks.some((t) => t.id === d.track_id && t.is_primary)) missing = true;
    }
  }
  const options = [...names]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id, name]) => ({ value: String(id), label: name }));
  return missing ? [...options, { value: EVENT_FILTER_UNSET, label: "No location" }] : options;
}

/** Every shift the loaded events sit on. Labels are only unique within a
 *  track, so the track is named too once there is more than one. */
export function eventShiftOptions(events: TournamentEvent[]): FilterOption[] {
  const shifts = new Map<number, { label: string; trackId: number; start: string }>();
  const trackNames = new Map<number, string>();
  for (const e of events) {
    for (const t of e.tracks) trackNames.set(t.id, t.name);
    for (const s of e.shifts) shifts.set(s.id, { label: s.label, trackId: s.track_id, start: s.start });
  }
  const multiTrack = new Set([...shifts.values()].map((s) => s.trackId)).size > 1;
  return [...shifts]
    .sort(([, a], [, b]) => a.start.localeCompare(b.start))
    .map(([id, s]) => ({
      value: String(id),
      label: multiTrack ? `${trackNames.get(s.trackId) ?? "Track"} · ${s.label}` : s.label,
    }));
}

/** What eventPassesFilters needs beyond the event itself. */
export interface EventFilterContext {
  /** This event's assignments — only read when a staffing value is picked. */
  assignmentsFor: (eventId: number) => readonly Assignment[];
  /** Which tracks count for location and staffing — all, or the board's tab. */
  showsTrack: (trackId: number) => boolean;
  /** Replaces the saved track filter — the board's track tab narrows to its own track. */
  trackOverride?: Set<string>;
}

/** Any of `values` in `selected` — for multi-valued fields, where an event on
 *  Day 1 and Day 2 must still pass a filter for Day 1. */
function allowsAny(selected: Set<string>, values: string[]): boolean {
  return selected.size === 0 || values.some((v) => selected.has(v));
}

/** This event's staffing answers on the tracks that count. */
function staffingValues(event: TournamentEvent, rows: readonly Assignment[], showsTrack: (id: number) => boolean): string[] {
  let needed = 0;
  let unfilled = 0;
  for (const detail of event.track_details) {
    if (!showsTrack(detail.track_id)) continue;
    for (const need of detail.needs ?? []) {
      needed += need.count;
      unfilled += Math.max(0, need.count - staffedCount(rows, need.role_id, detail.track_id));
    }
  }
  const values: string[] = [];
  if (needed === 0) values.push("no_needs");
  else values.push(unfilled === 0 ? "full" : "short");
  if (!rows.some((a) => showsTrack(a.track.id))) values.push("empty");
  return values;
}

/** The one predicate both pages filter events with. */
export function eventPassesFilters(event: TournamentEvent, filters: EventsFilterState, ctx: EventFilterContext): boolean {
  if (!filterAllows(filters.division, event.division ?? EVENT_FILTER_UNSET)) return false;
  if (!filterAllows(filters.type, event.event_type)) return false;
  if (!filterAllows(filters.category, eventCategoryKey(event))) return false;
  if (!allowsAny(ctx.trackOverride ?? filters.track, event.tracks.map((t) => String(t.id)))) return false;
  if (filters.building.size > 0) {
    // A competition track with no building is what "No location" means.
    const buildings = event.track_details
      .filter((d) => ctx.showsTrack(d.track_id))
      .flatMap((d) => d.building_id !== null
        ? [String(d.building_id)]
        : event.tracks.some((t) => t.id === d.track_id && t.is_primary) ? [EVENT_FILTER_UNSET] : []);
    if (!allowsAny(filters.building, buildings)) return false;
  }
  if (!filterAllows(filters.shifts, event.shifts.length > 0 ? "has" : "none")) return false;
  if (!allowsAny(filters.shift, event.shifts.map((s) => String(s.id)))) return false;
  if (filters.staffing.size > 0
    && !allowsAny(filters.staffing, staffingValues(event, ctx.assignmentsFor(event.id), ctx.showsTrack))) return false;
  return true;
}

export function isEventsFilterActive(filters: EventsFilterState): boolean {
  return isFilterActive(filters);
}

/** The saved wire shape (arrays, keyed by filter) back into filter state.
    Unknown keys are dropped — a filter removed in a later release must not
    come back as a narrowing nothing in the modal can clear. Values stay as
    saved: a category that no longer exists simply matches nothing, and its
    chip is there to be removed. */
export function eventsFilterFromStored(
  stored: Record<string, string[]> | null | undefined,
): EventsFilterState {
  // Staffing's values changed (staffed/unstaffed -> four); an old one would
  // match nothing and hide every event.
  return filterStateFromStored(EVENTS_FILTER_KEYS, stored, (key, v) => key !== "staffing" || STAFFING_VALUES.has(v));
}

export function eventsFilterToStored(filters: EventsFilterState): Record<string, string[]> {
  return filterStateToStored(filters);
}

interface EventsFilterModalProps {
  divisionOptions: FilterOption[];
  typeOptions: FilterOption[];
  categoryOptions: FilterOption[];
  /** Omit (or pass one) to hide the Track section — on a board track tab, or
   *  with only one track, there is nothing to pick between. */
  trackOptions?: FilterOption[];
  buildingOptions: FilterOption[];
  shiftOptions: FilterOption[];
  filters: EventsFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: EventsFilterState) => void;
  onClose: () => void;
}

// Fixed handfuls of values are button groups; Category grows with the event
// list (checkbox list); Track, Building and Shift are open-ended short names,
// so chips + a picker beat a checkbox column taller than the rest of the modal.
export function EventsFilterModal({
  divisionOptions, typeOptions, categoryOptions, trackOptions, buildingOptions, shiftOptions,
  filters, onApply, onClose,
}: EventsFilterModalProps) {
  const sections: FilterSectionConfig<EventsFilterKey>[] = [
    { key: "division", title: "Division", options: divisionOptions, control: "divisions" },
    { key: "type", title: "Type", options: typeOptions, control: "buttons" },
    { key: "category", title: "Category", options: categoryOptions, control: "checkbox" },
    { key: "track", title: "Track", options: trackOptions ?? [], control: "chips", hidden: (trackOptions?.length ?? 0) < 2 },
    { key: "building", title: "Building", options: buildingOptions, control: "chips", hidden: buildingOptions.length === 0 },
    { key: "staffing", title: "Staffing", options: STAFFING_OPTIONS, control: "buttons" },
    { key: "shifts", title: "Shifts", options: SHIFTS_OPTIONS, control: "buttons" },
    { key: "shift", title: "Shift", options: shiftOptions, control: "chips", hidden: shiftOptions.length === 0 },
  ];

  return (
    <FilterModal
      title="Filter events"
      sections={sections}
      filters={filters}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
