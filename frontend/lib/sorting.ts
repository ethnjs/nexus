/**
 * Multi-key sorting, shared by every surface that offers it.
 *
 * A surface supplies two things: the fields it can sort by, and a function
 * turning a row into one field's value. Everything else — how values compare,
 * where nulls go, how ties break — is decided once here, so two tables sorted
 * "by category" never disagree about what that means.
 */

export type SortDirection = 'asc' | 'desc'

export interface SortRule<F extends string = string> {
  field: F
  direction: SortDirection
}

/** What a row is worth under one sort field. null/undefined means "no value",
 *  which sorts last in *both* directions — see compareValues. */
export type SortValue = string | number | null | undefined

/**
 * Two values under one key, ascending.
 *
 * Nulls last regardless of direction. Flipping to descending is a request to
 * reverse the ranking, not to promote the rows that have no ranking at all —
 * an event with no category jumping to the top of a descending category sort
 * is nobody's intent, and a plain comparator does exactly that.
 *
 * Strings compare with localeCompare (so "Ärger" files with A, and numbers
 * inside names order 2 before 10), numbers numerically.
 */
export function compareValues(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * One comparator from a chain of rules.
 *
 * `tail` is the surface's own final tiebreak, appended after every chain and
 * never shown in the UI. It exists because a sort must be a *total* order:
 * two rows the rules can't separate would otherwise fall back to whatever
 * order the array happened to be in, which changes between fetches and makes
 * rows swap places for no reason the viewer can see.
 */
export function buildComparator<T, F extends string>(
  rules: readonly SortRule<F>[],
  valueOf: (row: T, field: F) => SortValue,
  tail: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    for (const rule of rules) {
      const cmp = compareValues(valueOf(a, rule.field), valueOf(b, rule.field))
      if (cmp !== 0) return rule.direction === 'asc' ? cmp : -cmp
    }
    return tail(a, b)
  }
}

/** Sorted copy. Array.sort mutates, and the rows it would mutate are React
 *  state on every caller. */
export function sortRows<T, F extends string>(
  rows: readonly T[],
  rules: readonly SortRule<F>[],
  valueOf: (row: T, field: F) => SortValue,
  tail: (a: T, b: T) => number,
): T[] {
  return [...rows].sort(buildComparator(rules, valueOf, tail))
}

/** The stored wire shape into rules, dropping anything this surface no longer
 *  sorts by — a field removed in a later release must not sit in the chain
 *  ordering nothing. */
export function sortRulesFromStored<F extends string>(
  stored: { field: string; direction?: string }[] | null | undefined,
  isKnownField: (field: string) => field is F,
): SortRule<F>[] {
  if (!Array.isArray(stored)) return []
  return stored
    .filter((rule): rule is { field: F; direction?: string } => isKnownField(rule.field))
    .map((rule) => ({ field: rule.field, direction: rule.direction === 'desc' ? 'desc' : 'asc' }))
}

export function sortRulesToStored<F extends string>(
  rules: readonly SortRule<F>[],
): { field: string; direction: SortDirection }[] {
  return rules.map((rule) => ({ field: rule.field, direction: rule.direction }))
}

/** Whether two chains sort the same way — for a Reset button that should
 *  only light up when there is something to reset. */
export function sameSortRules<F extends string>(
  a: readonly SortRule<F>[], b: readonly SortRule<F>[],
): boolean {
  return a.length === b.length
    && a.every((rule, i) => rule.field === b[i].field && rule.direction === b[i].direction)
}

/**
 * A column-header click on `field`: absent → appended ascending, ascending →
 * descending, descending → removed. Click order is chain order, which is the
 * multi-sort. While the chain is still `defaults`, the first click replaces
 * it — appending would only break the default's ties and look like nothing
 * happened. Emptying the chain hands back the defaults.
 */
export function cycleSortRule<F extends string>(
  rules: readonly SortRule<F>[], field: F, defaults: readonly SortRule<F>[],
): SortRule<F>[] {
  const base = sameSortRules(rules, defaults) ? [] : rules
  const current = base.find((rule) => rule.field === field)
  let next: SortRule<F>[]
  if (!current) next = [...base, { field, direction: 'asc' }]
  else if (current.direction === 'asc') next = base.map((rule) => (rule.field === field ? { field, direction: 'desc' } : rule))
  else next = base.filter((rule) => rule.field !== field)
  return next.length > 0 ? next : [...defaults]
}
