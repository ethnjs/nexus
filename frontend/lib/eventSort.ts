import type { Assignment, TournamentEvent } from '@/lib/api'
import { unfilledCount } from '@/lib/assignments/staffing'
import { eventNameWithDivision, trackLocationLabel } from '@/lib/eventDisplay'
import type { SortFieldOption } from '@/components/ui/SortModal'
import type { SortRule, SortValue } from '@/lib/sorting'

/** Shared by the assignments board and the events table. Mirrors
 *  KNOWN_ASSIGNMENT_EVENT_SORT_FIELDS (and KNOWN_EVENT_SORT_FIELDS) in
 *  display_config.py — the server validates what it stores against them. */
export const EVENT_SORT_FIELDS = ['name', 'start', 'staffing', 'category', 'location'] as const
export type EventSortField = (typeof EVENT_SORT_FIELDS)[number]

export function isEventSortField(field: string): field is EventSortField {
  return (EVENT_SORT_FIELDS as readonly string[]).includes(field)
}

/** Direction labels say what the order *is*, not which way the arrow points:
 *  "Most short first" is the thing a coordinator wants, and "Descending" makes
 *  them work out what a descending gap means. */
export const EVENT_SORT_OPTIONS: SortFieldOption[] = [
  { value: 'name', label: 'Name', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'start', label: 'Start time', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'staffing', label: 'Staffing gap', ascLabel: 'Filled first', descLabel: 'Most short first' },
  { value: 'category', label: 'Category', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'location', label: 'Location', ascLabel: 'A → Z', descLabel: 'Z → A' },
]

/** Name A→Z, which is the order you can predict without reading the config. */
export const DEFAULT_EVENT_SORT: SortRule<EventSortField>[] = [
  { field: 'name', direction: 'asc' },
]

/** What the chain falls back to, and the sentence the modal prints. */
export const EVENT_SORT_TIEBREAK = 'name'

/**
 * What an event is called for the purpose of ordering — eventNameWithDivision,
 * which is the same label a results report identifies a row by.
 *
 * Division is not a sort key of its own here. Within one tournament it is
 * part of the event's identity — "Crime Busters B" and "Crime Busters C" are
 * two events, not one event seen two ways — so sorting by name has to keep
 * them adjacent and in division order, and a separate Division key would only
 * ever scatter the same event's divisions apart.
 */
const sortName = eventNameWithDivision

/**
 * One event's value under one sort field.
 *
 * `rowsFor` and `showsTrack` come from the board because two of these fields
 * are not on the event at all: staffing is the assignments against its needs,
 * and an event has no time of its own — its schedule is its shifts, and which
 * of those count depends on the tab.
 */
export function eventSortValue(
  event: TournamentEvent,
  field: EventSortField,
  rowsFor: (eventId: number) => readonly Assignment[],
  showsTrack: (trackId: number) => boolean,
): SortValue {
  switch (field) {
    case 'name': return sortName(event)
    // The joined canonical event's, since TournamentEvent has no category of
    // its own. A trial event linked to nothing has none, and sorts last.
    case 'category': return event.event?.category.name ?? null
    case 'start': {
      const starts = event.shifts.map((shift) => new Date(shift.start).getTime())
      return starts.length > 0 ? Math.min(...starts) : null
    }
    case 'staffing': return unfilledCount(event, rowsFor(event.id), showsTrack)
    // The first location the event has on a track that is on screen, by the
    // label itself. An event across two buildings sorts under the earlier of
    // them — it has to be filed *somewhere*, and the alternative is a row
    // that moves depending on which of its tracks was listed first.
    case 'location': {
      const labels = event.track_details
        .filter((detail) => showsTrack(detail.track_id))
        .map((detail) => trackLocationLabel(detail))
        .filter((label): label is string => label !== null)
      return labels.length > 0 ? labels.sort()[0] : null
    }
  }
}

/**
 * The tail every chain ends with.
 *
 * Not configurable and not shown: a sort has to be a total order, or two rows
 * the rules cannot separate fall back to whatever order the fetch returned
 * and swap places on the next one. Name (division included, see sortName)
 * because that is what a reader expects of "the rest", then id, which is the
 * only thing guaranteed unique.
 */
export function eventSortTiebreak(a: TournamentEvent, b: TournamentEvent): number {
  const byName = sortName(a).localeCompare(sortName(b), undefined, { numeric: true, sensitivity: 'base' })
  return byName !== 0 ? byName : a.id - b.id
}
