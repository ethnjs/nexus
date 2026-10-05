import type { MembershipFull } from '@/lib/api'
import type { SortFieldOption } from '@/components/ui/SortModal'
import type { SortRule, SortValue } from '@/lib/sorting'

/** Mirrors KNOWN_SORT_FIELDS in display_config.py — the server validates
 *  what it stores against them. */
export const MEMBER_SORT_FIELDS = ['first_name', 'last_name', 'joined', 'account_age'] as const
export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number]

export function isMemberSortField(field: string): field is MemberSortField {
  return (MEMBER_SORT_FIELDS as readonly string[]).includes(field)
}

/** Direction labels say what the order is — see EVENT_SORT_OPTIONS. */
export const MEMBER_SORT_OPTIONS: SortFieldOption[] = [
  { value: 'first_name', label: 'First name', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'last_name', label: 'Last name', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'joined', label: 'Joined', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'account_age', label: 'Account age', ascLabel: 'Oldest first', descLabel: 'Newest first' },
]

/** Newest joins first — the order the table had before it took a chain. */
export const DEFAULT_MEMBER_SORT: SortRule<MemberSortField>[] = [
  { field: 'joined', direction: 'desc' },
]

/** What the chain falls back to, and the sentence the modal prints. */
export const MEMBER_SORT_TIEBREAK = 'first name, then last name'

/** The single `sort` this table saved before it took a chain, as one. */
export function legacyMemberSortRules(
  sort: { field: string; direction?: string } | null | undefined,
): SortRule<MemberSortField>[] | null {
  if (!sort || !isMemberSortField(sort.field)) return null
  return [{ field: sort.field, direction: sort.direction === 'asc' ? 'asc' : 'desc' }]
}

// A missing name is null, not "", so it sorts last in both directions.
export function memberSortValue(m: MembershipFull, field: MemberSortField): SortValue {
  switch (field) {
    case 'first_name': return m.user.first_name || null
    case 'last_name': return m.user.last_name || null
    case 'joined': return new Date(m.created_at).getTime()
    // An older account has an earlier created_at, so ascending is oldest first.
    case 'account_age': return new Date(m.user.created_at).getTime()
  }
}

const byName = (a: string | null, b: string | null) =>
  (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' })

/** The hidden tail every chain ends with, so the order is total (see
 *  buildComparator): first name, last name, then id. */
export function memberSortTiebreak(a: MembershipFull, b: MembershipFull): number {
  return byName(a.user.first_name, b.user.first_name)
    || byName(a.user.last_name, b.user.last_name)
    || a.id - b.id
}
