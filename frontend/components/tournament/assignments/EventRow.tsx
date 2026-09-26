"use client";

import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'

import { MemberChip } from '@/components/tournament/assignments/MemberChip'
import { TrackSections } from '@/components/tournament/assignments/TrackSections'
import type { EventDisplayState } from '@/components/tournament/assignments/EventDisplayModal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Assignment, Role, TournamentEvent, TournamentTrack } from '@/lib/api'
import { buildLanes } from '@/lib/assignments/board'
import type { Flag } from '@/lib/assignments/flags'
import type { AssignmentRole } from '@/lib/assignments/lanes'
import { eventName } from '@/lib/eventDisplay'

function divisionVariant(division: string | null) {
  if (division === 'A') return 'divisionA' as const
  if (division === 'B') return 'divisionB' as const
  return 'divisionC' as const
}

export function EventRow({
  event, rowAssignments, roleCatalog, flagsFor, display, activeTrackId, simple,
  onResize, onResizeCommit, onToggleRole, onPickRole, onRemove, onPickDefaultRole,
}: {
  event: TournamentEvent
  rowAssignments: Assignment[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  display: EventDisplayState
  /** null on the All tab (and always, in simple mode). Set, every section
   *  drops its track name — the tab already said it — while keeping the
   *  role pill, time, location and staffing. */
  activeTrackId: number | null
  /** A one-track tournament: there is only ever one answer, so the sole
   *  track's own name would label something nobody was choosing between.
   *  An event that merely happens to run on one track *of several* in an
   *  advanced tournament still gets the label — the ambiguity is real
   *  there, just not for this event. */
  simple: boolean
  onResize: (laneKey: string, eventId: number, edge: 'start' | 'end', index: number) => void
  onResizeCommit: (laneKey: string, eventId: number, beforeRows: Assignment[]) => void
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onPickRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onRemove: (laneKey: string, eventId: number) => void
  /** A track's own header (multi-track events on the All tab) lets a TD
   *  repoint its default role right there. Applying it — the track PATCH
   *  plus migrating existing holders of the old default — is the page's job,
   *  since only it holds every track's and every assignment's state. */
  onPickDefaultRole: (track: TournamentTrack, role: Role) => Promise<void>
}) {
  // Two targets on a row with shifts: the event's own name means "every
  // shift", and each timeline column means that one.
  const { setNodeRef: setAllShiftsRef, isOver: overAllShifts } = useDroppable({
    id: `allday:${event.id}`,
    data: { kind: 'allday', eventId: event.id },
  })
  // The bare row is a target only for an event on no track at all. Every
  // other event is a stack of track sections, and each of those is either a
  // grid of shift columns or a target in its own right — both of which name
  // the track they bill, where this one can only guess at `tracks[0]`.
  const { setNodeRef: setRowRef, isOver: overRow } = useDroppable({
    id: `event:${event.id}`,
    data: { kind: 'event', eventId: event.id },
    disabled: event.tracks.length > 0,
  })
  // Memoised so the lane objects survive this row's per-crossing re-renders
  // (useDroppable above) — ChipBody's memo compares them by identity.
  const trackless = event.tracks.length === 0
  const tracklessLanes = useMemo(
    () => (trackless ? buildLanes(rowAssignments, []).unpinned : []),
    [rowAssignments, trackless],
  )

  // A simple tournament has exactly one track, so there is never a real
  // choice for a label to name — falling back to it here is what keeps a
  // one-track tournament from printing a track name nobody needed labelled,
  // same as an actual track tab does for the same reason.
  const focusedTrackId = activeTrackId ?? (simple ? event.tracks[0]?.id ?? null : null)

  return (
    // The event names itself in a column of its own and hands the rest of the
    // row to its tracks. The name earns the rail: it is what the eye runs
    // down to find a row, and putting it on the same stack as the tracks
    // buried it under everything each track had to say.
    <div
      style={{
        display: 'grid', gridTemplateColumns: '220px 1fr', gap: '12px',
        padding: '10px 12px', borderRadius: 'var(--radius-md)',
        // Border stays the ordinary colour while dragging — a tint carries
        // the "you can drop here" signal without the row jumping out.
        border: '1px solid var(--color-border)',
        background: overRow ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
        transition: 'background 120ms ease',
        // `start`, not `center`: centering pins the row to one line's height,
        // so a second section spills past the border instead of growing it.
        minHeight: '56px', alignItems: 'start',
      }}
    >
      {/* The name is also the all-shifts target — it is the one part of the
          row that speaks for every track at once, which is exactly what
          dropping here means. */}
      <div
        ref={event.shifts.length > 0 ? setAllShiftsRef : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
          position: 'relative', borderRadius: 'var(--radius-sm)',
          padding: '2px 4px', margin: '-2px -4px',
          background: overAllShifts ? 'var(--color-accent-subtle)' : 'transparent',
          transition: 'background 120ms ease',
        }}
      >
        {/* eventName, not `name`: a catalog-linked event leaves its own
            name column null and carries it on the joined canonical event. */}
        <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: '13px' }}>
          {eventName(event)}
        </span>
        {display.division && event.division && (
          <Badge variant={divisionVariant(event.division)}>{event.division}</Badge>
        )}
        {display.type && event.event_type === 'trial' && <Badge variant="pending">Trial</Badge>}
        {/* Says what dropping here does, and only while it would do it. */}
        {overAllShifts && event.shifts.length > 0 && (
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
            color: 'var(--color-accent)',
          }}>
            All shifts
          </span>
        )}
      </div>

      {trackless ? (
        // No track means nowhere to hang a section: no location to store, no
        // needs to declare, and no default role to bill a drop to. The row
        // itself stays the target — the alternative is an event nothing can
        // be assigned to at all.
        <div ref={setRowRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {tracklessLanes.length === 0 ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <EmptyState size="sm" title="Nobody assigned" />
            </div>
          ) : (
            tracklessLanes.map((lane) => (
              <MemberChip
                key={lane.key}
                lane={lane}
                eventId={event.id}
                roleCatalog={roleCatalog}
                flagsFor={flagsFor}
                onToggleRole={onToggleRole}
                onPickRole={onPickRole}
                onRemove={onRemove}
              />
            ))
          )}
        </div>
      ) : (
        <TrackSections
          event={event}
          rowAssignments={rowAssignments}
          roleCatalog={roleCatalog}
          flagsFor={flagsFor}
          display={display}
          showTrackLabels={display.tracks && focusedTrackId === null}
          onResize={onResize}
          onResizeCommit={onResizeCommit}
          onToggleRole={onToggleRole}
          onPickRole={onPickRole}
          onRemove={onRemove}
          overAllShifts={overAllShifts}
          onPickDefaultRole={onPickDefaultRole}
        />
      )}
    </div>
  )
}
