"use client";

import {
  emptyFilterState, FilterModal, FilterOption, FilterSectionConfig, FilterState, isFilterActive,
} from "@/components/ui/FilterModal";
import { TournamentEvent } from "@/lib/api";

// track/staffing are optional per caller (see trackOptions/showStaffing below)
// — the Events tab has neither a per-event track list nor assignment data to
// filter by, so its state simply carries them as always-empty sets.
export const EVENTS_FILTER_KEYS = ["division", "type", "category", "track", "staffing"] as const;
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

const STAFFING_OPTIONS: FilterOption[] = [
  { value: "staffed", label: "Staffed" },
  { value: "unstaffed", label: "Unstaffed" },
];

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
  const state = emptyFilterState(EVENTS_FILTER_KEYS);
  for (const key of EVENTS_FILTER_KEYS) {
    const values = stored?.[key];
    if (Array.isArray(values)) {
      state[key] = new Set(values.filter((v): v is string => typeof v === "string"));
    }
  }
  return state;
}

/** Filter state as the stored wire shape, empty keys dropped. These are the
    *selected* values — this table filters in the client, so what's persisted
    is what the FilterModal deals in rather than query params. */
export function eventsFilterToStored(filters: EventsFilterState): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, values]): [string, string[]] => [key, [...values]])
      .filter(([, values]) => values.length > 0),
  );
}

interface EventsFilterModalProps {
  divisionOptions: FilterOption[];
  typeOptions: FilterOption[];
  categoryOptions: FilterOption[];
  /** Omit to hide the Track section — the Events tab has no per-event track
   *  list to filter against; the assignments board does. */
  trackOptions?: FilterOption[];
  /** Adds the Staffed/Unstaffed section. Off by default: staffing is derived
   *  from assignment data, which the Events tab doesn't load (see the note on
   *  TournamentEvent's `event` field about assignments staying a separate
   *  fetch, joined client-side). The assignments board, which already loads
   *  that data, turns this on. */
  showStaffing?: boolean;
  filters: EventsFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: EventsFilterState) => void;
  onClose: () => void;
}

// Division/Type/Staffing have a handful of fixed values (button group);
// Category is open-ended and grows with the event list (checkbox list); Track
// is open-ended too but every value is a short name, so chips + a picker
// beat a checkbox column that would be the tallest thing in the modal.
export function EventsFilterModal({
  divisionOptions, typeOptions, categoryOptions, trackOptions, showStaffing, filters, onApply, onClose,
}: EventsFilterModalProps) {
  const sections: FilterSectionConfig<EventsFilterKey>[] = [
    { key: "division", title: "Division", options: divisionOptions, control: "buttons" },
    { key: "type", title: "Type", options: typeOptions, control: "buttons" },
    { key: "category", title: "Category", options: categoryOptions, control: "checkbox" },
  ];
  if (trackOptions) sections.push({ key: "track", title: "Track", options: trackOptions, control: "chips" });
  if (showStaffing) sections.push({ key: "staffing", title: "Staffing", options: STAFFING_OPTIONS, control: "buttons" });

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
