"use client";

import {
  emptyFilterState, FilterModal, FilterOption, FilterSectionConfig, FilterState, isFilterActive,
} from "@/components/ui/FilterModal";

export const EVENTS_FILTER_KEYS = ["division", "type", "category"] as const;
type EventsFilterKey = (typeof EVENTS_FILTER_KEYS)[number];

export type EventsFilterState = FilterState<EventsFilterKey>;

export function isEventsFilterActive(filters: EventsFilterState): boolean {
  return isFilterActive(filters);
}

/** The saved wire shape (arrays, keyed by filter) back into filter state.
    Unknown keys are dropped — a filter removed in a later release must not
    come back as an exclusion nothing in the modal can clear. Values stay as
    saved: a category that no longer exists simply excludes nothing. */
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
    *excluded* values — this table filters in the client, so what's persisted
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
  filters: EventsFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: EventsFilterState) => void;
  onClose: () => void;
}

// Division/Type have a handful of fixed values (button group); Category is
// open-ended and grows with the event list (checkbox list).
export function EventsFilterModal({ divisionOptions, typeOptions, categoryOptions, filters, onApply, onClose }: EventsFilterModalProps) {
  const sections: FilterSectionConfig<EventsFilterKey>[] = [
    { key: "division", title: "Division", options: divisionOptions, control: "buttons" },
    { key: "type", title: "Type", options: typeOptions, control: "buttons" },
    { key: "category", title: "Category", options: categoryOptions, control: "checkbox" },
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
