import type { DisplayConfigCatalogItem, FilterOptionGroup, MembershipFull } from '@/lib/api'
import type { SortFieldOption, SortPill, SortPillOption } from '@/components/ui/SortModal'
import type { SortRule, SortValue } from '@/lib/sorting'

/** The fields every roster can sort by. Mirrors KNOWN_SORT_FIELDS in
 *  display_config.py — the server validates what it stores against them. */
export const FIXED_MEMBER_SORT_FIELDS = ['first_name', 'last_name', 'joined', 'account_age', 'onboarding'] as const

/** A fixed field, or one of the per-track ones below. Keys share the column
 *  namespaces ("track:3"), so the server loads a sort's data the way it loads
 *  a column's. */
export type MemberSortField = string

// Mirrors MEMBER_SORT_FIELD_PATTERN in display_config.py.
const PER_TRACK_FIELD = /^(track:\d+|availability_track:\d+|event_pref:\d+:\d+|lunch:\d+:[a-z0-9_]+)$/

export function isMemberSortField(field: string): field is MemberSortField {
  return (FIXED_MEMBER_SORT_FIELDS as readonly string[]).includes(field) || PER_TRACK_FIELD.test(field)
}

const FIXED_OPTIONS: SortFieldOption[] = [
  { value: 'first_name', label: 'First name', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'last_name', label: 'Last name', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'joined', label: 'Joined', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'account_age', label: 'Account age', ascLabel: 'Oldest first', descLabel: 'Newest first' },
  { value: 'onboarding', label: 'Onboarding', ascLabel: 'Least complete first', descLabel: 'Most complete first' },
]

/**
 * Everything the modal offers: the fixed fields, then one category per kind
 * of per-track data, each narrowed in the modal by pills — a track, then the
 * lunch question or preference event on it. Tracks and lunch questions come
 * from the display-config catalog the page already holds; each track's
 * preference events from the roster's filter options. A category with
 * nothing to pick (no lunch questions yet) isn't offered.
 */
export function memberSortOptions(
  catalog: DisplayConfigCatalogItem[],
  eventPrefs: FilterOptionGroup[],
): SortFieldOption[] {
  const tracksIn = (prefix: string) => catalog
    .filter((item) => item.key.startsWith(prefix))
    .map((item) => ({ value: item.key.slice(prefix.length), label: item.label }))
  const trackName = new Map(tracksIn('track:').map((t) => [t.value, t.label]))

  // "lunch:{track}:{question}", labelled "Day 1 — Protein" by the catalog.
  const lunch = catalog
    .filter((item) => item.key.startsWith('lunch:'))
    .map((item) => {
      const [, track, question] = item.key.split(':')
      return { track, question, label: item.label.split(' — ').pop() ?? question }
    })
  const lunchTracks = [...new Set(lunch.map((l) => l.track))]
    .map((track) => ({ value: track, label: trackName.get(track) ?? `Track ${track}` }))

  const trackPill = (options: SortPillOption[]): SortPill => ({ label: 'Track', options: () => options })
  const categories: SortFieldOption[] = [
    {
      value: 'track', label: 'Track status', pills: [trackPill(tracksIn('track:'))],
      ascLabel: 'Confirmed first', descLabel: 'Declined first',
    },
    {
      value: 'availability_track', label: 'Availability', pills: [trackPill(tracksIn('availability_track:'))],
      ascLabel: 'Least available first', descLabel: 'Most available first',
    },
    {
      value: 'lunch', label: 'Lunch', ascLabel: 'A → Z', descLabel: 'Z → A',
      pills: [
        trackPill(lunchTracks),
        {
          label: 'Question',
          options: ([track]) => lunch
            .filter((l) => l.track === track)
            .map((l) => ({ value: l.question, label: l.label })),
        },
      ],
    },
    {
      value: 'event_pref', label: 'Event preference', ascLabel: 'Top choice first', descLabel: 'Lowest rank first',
      pills: [
        trackPill(eventPrefs.map((track) => ({ value: track.value, label: track.label }))),
        { label: 'Event', options: ([track]) => eventPrefs.find((t) => t.value === track)?.options ?? [] },
      ],
    },
  ]
  return [
    ...FIXED_OPTIONS,
    // Offered once there is a track to pick.
    ...categories.filter((category) => category.pills![0].options([]).length > 0),
  ]
}

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

// Ascending order of a track status. "pending" (no row at all) isn't here, so
// it reads as no value and sorts last both ways.
const STATUS_ORDER: Record<string, number> = { confirmed: 0, interested: 1, declined: 2 }

// A pick from a question with no ranks (checkboxes): after every real rank,
// before not having picked the event at all.
const PICKED_UNRANKED = Number.MAX_SAFE_INTEGER

/** The response key a sort field reads — absent on the rows means the roster
 *  was fetched without it, and the page has to reload before it can sort. */
export function memberSortDataKey(field: MemberSortField): keyof MembershipFull | null {
  if (field === 'onboarding') return 'onboarding'
  if (field.startsWith('track:')) return 'track_statuses'
  if (field.startsWith('availability_track:')) return 'availability'
  if (field.startsWith('event_pref:')) return 'event_preferences'
  if (field.startsWith('lunch:')) return 'lunch'
  return null
}

// A missing name is null, not "", so it sorts last in both directions.
export function memberSortValue(m: MembershipFull, field: MemberSortField): SortValue {
  switch (field) {
    case 'first_name': return m.user.first_name || null
    case 'last_name': return m.user.last_name || null
    case 'joined': return new Date(m.created_at).getTime()
    // An older account has an earlier created_at, so ascending is oldest first.
    case 'account_age': return new Date(m.user.created_at).getTime()
    // null with no live steps: there's nothing to be complete with.
    case 'onboarding': return m.onboarding && m.onboarding.total > 0 ? m.onboarding.completed / m.onboarding.total : null
  }
  const [namespace, first, second] = field.split(':')
  const trackId = Number(first)
  if (namespace === 'track') {
    const status = (m.track_statuses ?? []).find((t) => t.track_id === trackId)?.status
    return status !== undefined && status in STATUS_ORDER ? STATUS_ORDER[status] : null
  }
  // A count, so no availability is 0 — least available, not "unknown". Only
  // rows fetched without the data have nothing to count.
  if (namespace === 'availability_track') {
    return m.availability ? m.availability.filter((a) => a.track_id === trackId).length : null
  }
  if (namespace === 'event_pref') {
    const eventId = Number(second)
    const option = (m.event_preferences ?? [])
      .find((p) => p.track_id === trackId)
      ?.options.find((o) => o.events.some((e) => e.id === eventId))
    return option ? option.rank ?? PICKED_UNRANKED : null
  }
  if (namespace === 'lunch') {
    const picks = (m.lunch ?? []).filter((row) => row.track_id === trackId && row.category === second)
    return picks.length > 0 ? picks.map((p) => p.value).sort().join(', ') : null
  }
  return null
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
