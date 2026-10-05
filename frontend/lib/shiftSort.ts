import type { TournamentShift, TournamentTrack } from '@/lib/api'
import { toDateInput } from '@/lib/timeFormat'
import type { SortFieldOption } from '@/components/ui/SortModal'
import type { SortRule, SortValue } from '@/lib/sorting'

/** Mirrors KNOWN_SHIFT_SORT_FIELDS in display_config.py — the server
 *  validates what it stores against them. */
export const SHIFT_SORT_FIELDS = ['label', 'track', 'date', 'start', 'end', 'duration', 'events'] as const
export type ShiftSortField = (typeof SHIFT_SORT_FIELDS)[number]

export function isShiftSortField(field: string): field is ShiftSortField {
  return (SHIFT_SORT_FIELDS as readonly string[]).includes(field)
}

/** Direction labels say what the order is — see EVENT_SORT_OPTIONS. */
export const SHIFT_SORT_OPTIONS: SortFieldOption[] = [
  { value: 'label', label: 'Label', ascLabel: 'A → Z', descLabel: 'Z → A' },
  { value: 'track', label: 'Track', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'date', label: 'Date', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'start', label: 'Start time', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'end', label: 'End time', ascLabel: 'Earliest first', descLabel: 'Latest first' },
  { value: 'duration', label: 'Duration', ascLabel: 'Shortest first', descLabel: 'Longest first' },
  { value: 'events', label: 'Events', ascLabel: 'Fewest first', descLabel: 'Most first' },
]

/** Start time, earliest first — the order the table had before it took a chain. */
export const DEFAULT_SHIFT_SORT: SortRule<ShiftSortField>[] = [
  { field: 'start', direction: 'asc' },
]

/** What the chain falls back to, and the sentence the modal prints. */
export const SHIFT_SORT_TIEBREAK = 'start time, then label'

/**
 * One shift's value under one sort field. `trackById` comes from the page,
 * since a shift carries only its track's id.
 */
export function shiftSortValue(
  shift: TournamentShift,
  field: ShiftSortField,
  trackById: (trackId: number) => TournamentTrack | undefined,
): SortValue {
  switch (field) {
    case 'label': return shift.label
    // By the day, not the name: "Saturday" / "Sunday" don't sort A→Z in
    // calendar order. ISO dates compare correctly as strings; the name
    // splits two tracks on the same date.
    case 'track': {
      const track = trackById(shift.track_id)
      if (!track) return null
      return track.start_date ? `${track.start_date} ${track.name}` : track.name
    }
    // The day alone (ISO, so it compares as text): shifts on one day tie and
    // fall to the next rule, which is what makes this different from start.
    case 'date': return toDateInput(shift.start)
    case 'start': return new Date(shift.start).getTime()
    case 'end': return new Date(shift.end).getTime()
    case 'duration': return new Date(shift.end).getTime() - new Date(shift.start).getTime()
    case 'events': return shift.event_count
  }
}

/**
 * The hidden tail every chain ends with, so the order is total (see
 * buildComparator). Start first so a Track sort keeps each day in time
 * order, then label, then id — the only thing guaranteed unique.
 */
export function shiftSortTiebreak(a: TournamentShift, b: TournamentShift): number {
  const byStart = new Date(a.start).getTime() - new Date(b.start).getTime()
  if (byStart !== 0) return byStart
  const byLabel = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
  return byLabel !== 0 ? byLabel : a.id - b.id
}
