import {
  type CanonicalEvent,
  EVENT_FORMAT_LABELS,
  EVENT_FORMATS,
  type EventCategory,
  type SeasonEvent,
  TOURNAMENT_DIVISIONS,
} from "@/lib/api";
import type { FilterField } from "@/lib/filters/model";
import { YES_NO_OPTIONS, yesNo } from "@/lib/seasonDefaults";

function categoryField(categories: EventCategory[]): FilterField<CanonicalEvent> {
  return {
    key: "category",
    label: "Category",
    ops: ["any_of", "none_of"],
    control: "chips",
    options: categories.map((c) => ({ value: c.name, label: c.name })),
    rowValues: (e) => [e.category.name],
  };
}

/** The event catalog's filter fields. */
export function catalogFilterFields(categories: EventCategory[]): FilterField<CanonicalEvent>[] {
  return [categoryField(categories)];
}

/** A season's filter fields. `activeIn` is the event's divisions switched on
 *  this season; `details` the row its format and flags are read from. */
export function seasonFilterFields(
  categories: EventCategory[],
  activeIn: (e: CanonicalEvent) => string[],
  details: (e: CanonicalEvent) => SeasonEvent | undefined,
): FilterField<CanonicalEvent>[] {
  return [
    categoryField(categories),
    // Active divisions, what the badges show: one merely present isn't on.
    {
      key: "division",
      label: "Division",
      ops: ["any_of", "all_of", "none_of"],
      control: "divisions",
      options: TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: `Division ${d}` })),
      rowValues: activeIn,
    },
    {
      key: "format",
      label: "Format",
      ops: ["any_of", "none_of", "empty", "not_empty"],
      control: "buttons",
      options: EVENT_FORMATS.map((f) => ({ value: f, label: EVENT_FORMAT_LABELS[f] })),
      opLabels: { empty: "has no format", not_empty: "has a format" },
      rowValues: (e) => {
        const format = details(e)?.format;
        return format ? [format] : [];
      },
    },
    {
      key: "impound",
      label: "Impound",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: YES_NO_OPTIONS,
      rowValues: (e) => [yesNo(details(e)?.has_impound)],
    },
    {
      key: "self_schedule",
      label: "Self-schedule",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: YES_NO_OPTIONS,
      rowValues: (e) => [yesNo(details(e)?.has_self_schedule)],
    },
  ];
}
