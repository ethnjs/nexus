"use client";

import {
  FilterModal, FilterOption, FilterSectionConfig, FilterState, isFilterActive,
} from "@/components/ui/FilterModal";

export const EVENTS_FILTER_KEYS = ["division", "type", "category"] as const;
type EventsFilterKey = (typeof EVENTS_FILTER_KEYS)[number];

export type EventsFilterState = FilterState<EventsFilterKey>;

export function isEventsFilterActive(filters: EventsFilterState): boolean {
  return isFilterActive(filters);
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
