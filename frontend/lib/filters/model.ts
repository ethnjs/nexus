import type { ReactNode } from "react";
import type {
  FilterCondition,
  FilterGroup,
  FilterOp,
  FilterOptionGroup,
  FilterOptionItem,
} from "@/lib/api";

/**
 * One field a table can be filtered by.
 *
 * Client-side tables give `rowValues`, which the matcher reads; the roster
 * filters on the server and leaves it out.
 */
export interface FilterField<Row = never> {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Heading the field is listed under in the field picker. */
  section?: string;
  ops: readonly FilterOp[];
  /** What a value is: picked from `options` (or a group's), or a date. */
  kind?: "options" | "date";
  options?: FilterOptionItem[];
  /** Paired fields: a row picks one of these first, then its options. */
  groups?: FilterOptionGroup[];
  /** Yes/no fields: one value at a time, so the operator reads "is". */
  single?: boolean;
  /** Wording for an operator where the stock one reads oddly ("is empty"
   *  on lunch is "not answered"). */
  opLabels?: Partial<Record<FilterOp, string>>;
  /** The row's values for this field, as option values or ISO dates; empty
   *  when it has none. `group` is the row's group for a paired field. */
  rowValues?: (row: Row, group: string | null) => string[];
}

export const OP_LABELS: Record<FilterOp, string> = {
  any_of: "is any of",
  none_of: "is none of",
  empty: "is empty",
  not_empty: "is not empty",
  before: "is before",
  after: "is after",
  within_last: "is within the last",
};

const SINGLE_OP_LABELS: Partial<Record<FilterOp, string>> = { any_of: "is", none_of: "is not" };

export const VALUELESS_OPS: ReadonlySet<FilterOp> = new Set(["empty", "not_empty"]);

export function opLabel(field: FilterField<never> | undefined, op: FilterOp, count = 2): string {
  const custom = field?.opLabels?.[op];
  if (custom) return custom;
  const single = field?.single || count === 1 ? SINGLE_OP_LABELS[op] : undefined;
  return single ?? OP_LABELS[op];
}

export function emptyFilter(): FilterGroup {
  return { op: "and", conditions: [] };
}

export function isGroup(item: FilterCondition | FilterGroup): item is FilterGroup {
  return "conditions" in item;
}

export function newCondition(
  field: FilterField<never>,
  group: string | null = null,
): FilterCondition {
  return { field: field.key, group, op: field.ops[0], values: [] };
}

/** Whether a row says enough to filter by. A half-built row (no values yet,
 *  no group picked) is kept in the draft but narrows nothing. */
export function isConditionComplete(
  condition: FilterCondition,
  field: FilterField<never> | undefined,
): boolean {
  if (!field?.ops.includes(condition.op)) return false;
  if (field.groups && !condition.group) return false;
  if (VALUELESS_OPS.has(condition.op)) return true;
  if (condition.op === "within_last") return /^\d+$/.test(condition.values[0] ?? "");
  return condition.values.length > 0;
}

function* leaves(filter: FilterGroup): Generator<FilterCondition> {
  for (const item of filter.conditions) {
    if (isGroup(item)) yield* leaves(item);
    else yield item;
  }
}

/** The badge count: rows that actually filter, inside groups too. */
export function countActiveConditions(
  filter: FilterGroup | null | undefined,
  fields: Map<string, FilterField<never>>,
): number {
  if (!filter) return 0;
  let count = 0;
  for (const condition of leaves(filter)) {
    if (isConditionComplete(condition, fields.get(condition.field))) count++;
  }
  return count;
}

/** The filter with half-built rows and emptied groups dropped: what gets
 *  saved, sent to the roster, or compared against defaults. */
export function pruneFilter(
  filter: FilterGroup,
  fields: Map<string, FilterField<never>>,
): FilterGroup {
  const conditions: (FilterCondition | FilterGroup)[] = [];
  for (const item of filter.conditions) {
    if (isGroup(item)) {
      const inner = pruneFilter(item, fields);
      if (inner.conditions.length > 0) conditions.push(inner);
    } else if (isConditionComplete(item, fields.get(item.field))) {
      conditions.push(VALUELESS_OPS.has(item.op) ? { ...item, values: [] } : item);
    }
  }
  return { op: filter.op, conditions };
}

/** A stored filter, kept to what this table can still show: rows on a field
 *  the table no longer has are dropped, so nothing narrows from nowhere. */
export function filterFromStored(
  stored: FilterGroup | null | undefined,
  fields: Map<string, FilterField<never>>,
): FilterGroup {
  if (!stored || !Array.isArray(stored.conditions)) return emptyFilter();
  const keep = (item: FilterCondition | FilterGroup): boolean =>
    isGroup(item) ? true : fields.has(item.field);
  return {
    op: stored.op === "or" ? "or" : "and",
    conditions: stored.conditions
      .filter(keep)
      .map((item) =>
        isGroup(item)
          ? { op: item.op === "or" ? "or" : "and", conditions: item.conditions.filter(keep) }
          : item,
      ),
  };
}

export function sameFilter(a: FilterGroup, b: FilterGroup): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function fieldMap<Row>(fields: FilterField<Row>[]): Map<string, FilterField<Row>> {
  return new Map(fields.map((field) => [field.key, field]));
}

/** A row in words, for suggestions and saved-filter previews:
 *  "Track status: Day 1 is any of Confirmed, Interested". */
export function describeCondition(
  condition: FilterCondition,
  field: FilterField<never> | undefined,
): string {
  if (!field) return condition.field;
  const group = condition.group
    ? field.groups?.find((g) => g.value === condition.group)
    : undefined;
  const subject = group ? `${field.label}: ${group.label}` : field.label;
  const options = group?.options ?? field.options ?? [];
  const named = condition.values.map(
    (value) => options.find((option) => option.value === value)?.label ?? value,
  );
  const verb = opLabel(field, condition.op, named.length);
  if (VALUELESS_OPS.has(condition.op)) return `${subject} ${verb}`;
  if (condition.op === "within_last") return `${subject} ${verb} ${named[0] ?? "…"} days`;
  return named.length > 0 ? `${subject} ${verb} ${named.join(", ")}` : `${subject} ${verb} …`;
}
