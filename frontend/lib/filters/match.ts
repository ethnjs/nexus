import type { FilterCondition, FilterGroup } from "@/lib/api";
import { toLocalDateString } from "@/lib/date";
import { type FilterField, isConditionComplete, isGroup } from "@/lib/filters/model";

function conditionMatches<Row>(
  row: Row,
  condition: FilterCondition,
  field: FilterField<Row>,
  today: Date,
): boolean {
  const values = field.rowValues?.(row, condition.group ?? null) ?? [];
  switch (condition.op) {
    case "any_of":
      return values.some((value) => condition.values.includes(value));
    case "all_of":
      return condition.values.every((value) => values.includes(value));
    case "none_of":
      return !values.some((value) => condition.values.includes(value));
    case "empty":
      return values.length === 0;
    case "not_empty":
      return values.length > 0;
    // Dates compare as ISO strings, on the day alone.
    case "before":
      return values.some((value) => value.slice(0, 10) < condition.values[0]);
    case "after":
      return values.some((value) => value.slice(0, 10) > condition.values[0]);
    case "within_last": {
      const since = new Date(today);
      since.setDate(since.getDate() - Number(condition.values[0]));
      const from = toLocalDateString(since);
      const to = toLocalDateString(today);
      return values.some((value) => value.slice(0, 10) >= from && value.slice(0, 10) <= to);
    }
    // Every value inside the range: a shift's start and end both, so it
    // lies wholly within it. Either end may be open.
    case "between": {
      const [from, to] = condition.values;
      return (
        values.length > 0 &&
        values.every((value) => (!from || value >= from) && (!to || value <= to))
      );
    }
    case "within_next": {
      const until = new Date(today);
      until.setDate(until.getDate() + Number(condition.values[0]));
      const from = toLocalDateString(today);
      const to = toLocalDateString(until);
      return values.some((value) => value.slice(0, 10) >= from && value.slice(0, 10) <= to);
    }
  }
}

function groupMatches<Row>(
  row: Row,
  filter: FilterGroup,
  fields: Map<string, FilterField<Row>>,
  today: Date,
): boolean {
  const results: boolean[] = [];
  for (const item of filter.conditions) {
    if (isGroup(item)) {
      if (item.conditions.length > 0) results.push(groupMatches(row, item, fields, today));
      continue;
    }
    const field = fields.get(item.field);
    // A half-built row or one on a field this table lacks narrows nothing.
    if (!field?.rowValues || !isConditionComplete(item, field as FilterField<never>)) continue;
    results.push(conditionMatches(row, item, field, today));
  }
  if (results.length === 0) return true;
  return filter.op === "or" ? results.some(Boolean) : results.every(Boolean);
}

/** Whether a client-side table's row passes its filter. */
export function matchesFilter<Row>(
  row: Row,
  filter: FilterGroup | null | undefined,
  fields: Map<string, FilterField<Row>>,
  today: Date = new Date(),
): boolean {
  return !filter || groupMatches(row, filter, fields, today);
}
