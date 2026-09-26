"use client";

import { memo, useMemo } from 'react'

import { TrackSection } from '@/components/tournament/assignments/TrackSection'
import type { EventDisplayState } from '@/components/tournament/assignments/EventDisplayModal'
import type {
  Assignment, Role, TournamentEvent, TournamentShift, TournamentTrack,
} from '@/lib/api'
import { buildLanes, type BoardHandlers } from '@/lib/assignments/board'
import type { Flag } from '@/lib/assignments/flags'
import type { Lane } from '@/lib/assignments/lanes'

// The narrowest a shiftless track's box may get before it wraps to its own
// line. Enough for one chip — a full name, its role pill and the × — since
// anything under that turns every name into an ellipsis.
const NO_SHIFT_MIN_WIDTH = 230

/** An event's shiftless tracks. `is_primary` is the whole test: only a
 *  primary track has dates, and only a dated track can hold shifts (see
 *  TournamentTrack in models.py), so a cosmetic one can never be a column. */
function cosmeticTracksOf(event: TournamentEvent): TournamentTrack[] {
  return event.tracks.filter((track) => !track.is_primary)
}

/**
 * Which column an unpinned chip sits in — the track the row itself names.
 *
 * This used to be a guess: an assignment carried only event, member, role and
 * shift, so a chip was filed under whichever track's *default role* it held,
 * which two tracks can share and a hand-picked role matches none of. The row
 * carries its track now (see tournament_track_id), so the question is
 * answered rather than inferred.
 */
function bucketByTrack(lanes: Lane[], tracks: TournamentTrack[]): Map<number, Lane[]> {
  const buckets = new Map(tracks.map((track) => [track.id, [] as Lane[]]))
  for (const lane of lanes) {
    buckets.get(lane.assignments[0].track.id)?.push(lane)
  }
  return buckets
}

/**
 * The no-shift area's columns: every cosmetic track the event runs on, plus
 * any track that actually holds unpinned rows here.
 *
 * The second half is not hypothetical — detaching a shift from an event
 * unpins its assignments while leaving them on that day's track (see
 * detach_shifts_from_assignments, which unpins rather than deletes precisely
 * so the staffing isn't silently lost). Without a column for it, "not lost"
 * would still mean "nowhere on screen".
 */
function noShiftTracksOf(event: TournamentEvent, unpinned: Lane[]): TournamentTrack[] {
  const columns = cosmeticTracksOf(event)
  const shown = new Set(columns.map((track) => track.id))
  for (const lane of unpinned) {
    const track = lane.assignments[0].track
    if (shown.has(track.id)) continue
    shown.add(track.id)
    // The event's own copy where there is one — it carries default_role_id,
    // which the column header names.
    columns.push(event.tracks.find((t) => t.id === track.id) ?? {
      ...track, tournament_id: event.tournament_id, start_date: null, end_date: null,
      university: null, location: null, division: null, is_archived: false,
      allow_confirm: false, default_role_id: null, created_at: '', updated_at: '',
    })
  }
  return columns
}

/**
 * Memoised: EventRow above calls useDroppable, so it re-renders every time
 * the drag crosses into a different target — twenty-five rows rebuilding
 * their lanes, chips and flags per crossing. The row's droppable state that
 * this subtree actually needs is `overAllShifts`, which only moves for the
 * one row being hovered; everything else it takes is stable while dragging,
 * so the other rows now bail out here.
 */
export const TrackSections = memo(function TrackSections({
  event, rowAssignments, roleCatalog, flagsFor, display, showTrackLabels, overAllShifts,
  handlers,
}: {
  event: TournamentEvent
  rowAssignments: Assignment[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  display: EventDisplayState
  showTrackLabels: boolean
  /** The row's all-shifts target is being hovered. */
  overAllShifts: boolean
  handlers: BoardHandlers
}) {
  const { unpinned } = buildLanes(rowAssignments, event.shifts.map((s) => s.id))

  // The event's own shifts, grouped by the track that owns them — a Map
  // remembers insertion order, and `event.shifts` already arrives schedule-
  // sorted (withOrderedShifts), so each group stays in that same order.
  const shiftsByTrack = useMemo(() => {
    const groups = new Map<number, TournamentShift[]>()
    for (const shift of event.shifts) {
      const list = groups.get(shift.track_id)
      if (list) list.push(shift)
      else groups.set(shift.track_id, [shift])
    }
    return groups
  }, [event.shifts])

  // Every track that gets a section: the event's own, plus any the rows point
  // at that the event's list has lost track of (noShiftTracksOf synthesises
  // those). Ones with shifts first, in schedule order, so the timelines read
  // top to bottom before the workstreams that sit beside them.
  const byId = new Map<number, TournamentTrack>()
  for (const track of event.tracks) byId.set(track.id, track)
  for (const track of noShiftTracksOf(event, unpinned)) {
    if (!byId.has(track.id)) byId.set(track.id, track)
  }
  const dated = [...shiftsByTrack.keys()]
    .map((id) => byId.get(id))
    .filter((track): track is TournamentTrack => track !== undefined)
  const datedIds = new Set(dated.map((t) => t.id))
  const shiftless = [...byId.values()].filter((t) => !datedIds.has(t.id))

  const unpinnedByTrack = bucketByTrack(unpinned, [...dated, ...shiftless])

  const sectionFor = (track: TournamentTrack) => {
    const shifts = shiftsByTrack.get(track.id) ?? []
    const shiftIdsHere = shifts.map((s) => s.id)
    // Only this track's own pinned rows — a row on another track's shift
    // would otherwise land in this call's `unpinned` bucket purely for
    // missing this track's shift list. The event-wide `unpinned` above is
    // the one that decides who is genuinely on no shift.
    const trackRows = rowAssignments.filter((a) => a.shift && shiftIdsHere.includes(a.shift.id))
    const { lanes } = shifts.length > 0
      ? buildLanes(trackRows, shiftIdsHere)
      : { lanes: [] as Lane[] }
    return (
      <TrackSection
        key={track.id}
        event={event}
        track={track}
        shifts={shifts}
        pinnedLanes={lanes}
        unpinnedLanes={unpinnedByTrack.get(track.id) ?? []}
        rowAssignments={rowAssignments}
        roleCatalog={roleCatalog}
        flagsFor={flagsFor}
        display={display}
        showLabel={showTrackLabels}
        overAllShifts={overAllShifts}
        handlers={handlers}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
      {/* A timeline owns its full width — its columns *are* the day, and two
          days side by side would halve every shift. */}
      {dated.map(sectionFor)}

      {/* The shiftless ones go back beside each other: they hold chips, not
          columns, so width costs them little. `flex` with a basis rather than
          equal grid tracks, because equal tracks divided by four squeezed
          every name card to an ellipsis — this way they share what's there
          and wrap once a column would drop under NO_SHIFT_MIN_WIDTH. */}
      {shiftless.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minWidth: 0 }}>
          {shiftless.map((track) => (
            <div
              key={track.id}
              // `min(..., 100%)` rather than a flat minimum: with both panels
              // docked the people area itself can be narrower than one box,
              // and a hard floor would push the row into a sideways scroll.
              style={{
                flex: `1 1 ${NO_SHIFT_MIN_WIDTH}px`,
                minWidth: `min(${NO_SHIFT_MIN_WIDTH}px, 100%)`,
              }}
            >
              {sectionFor(track)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
