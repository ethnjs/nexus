"use client";

import { useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'

import { MemberChip } from '@/components/tournament/assignments/MemberChip'
import { TrackSections } from '@/components/tournament/assignments/TrackSections'
import type { EventDisplayState } from '@/components/tournament/assignments/EventDisplayModal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Assignment, Role, TournamentEvent } from '@/lib/api'
import { buildLanes, type BoardHandlers } from '@/lib/assignments/board'
import type { Flag } from '@/lib/assignments/flags'
import { eventName } from '@/lib/eventDisplay'

function divisionVariant(division: string | null) {
  if (division === 'A') return 'divisionA' as const
  if (division === 'B') return 'divisionB' as const
  return 'divisionC' as const
}

export function EventRow({
  event, rowAssignments, roleCatalog, flagsFor, display, activeTrackId, simple,
  selected, onOpen, handlers,
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
  /** This row's panel is the one open. */
  selected?: boolean
  /** Opens this event's panel. Omitted for a viewer who can't manage events,
   *  which is also what leaves the row without a pointer cursor. */
  onOpen?: () => void
  handlers: BoardHandlers
}) {
  // The bare row is a target only for an event on no track at all. Every
  // other event is a stack of track sections, and each of those is either a
  // grid of shift columns or a target in its own right — both of which name
  // the track they bill, where this one can only guess at `tracks[0]`.
  const { setNodeRef: setRowRef, isOver: overRow } = useDroppable({
    id: `event:${event.id}`,
    data: { kind: 'event', eventId: event.id, label: eventName(event) },
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

  // The row is the target; anything with its own answer to a click is not.
  // Asked of the click's origin rather than wired per control, because the
  // row is a stack of components that keeps growing — a pill menu, a chip,
  // its × — and each would otherwise have to remember to stop the bubble.
  function openFromRow(e: ReactMouseEvent<HTMLDivElement>) {
    const from = e.target as HTMLElement
    if (from.closest('button, a, input, select, textarea, [data-row-click-opaque]')) return
    onOpen?.()
  }

  return (
    // The event names itself in a column of its own and hands the rest of the
    // row to its tracks. The name earns the rail: it is what the eye runs
    // down to find a row, and putting it on the same stack as the tracks
    // buried it under everything each track had to say.
    <div
      onClick={onOpen ? openFromRow : undefined}
      style={{
        cursor: onOpen ? 'pointer' : undefined,
        display: 'grid', gridTemplateColumns: '220px 1fr', gap: '12px',
        padding: '10px 12px', borderRadius: 'var(--radius-md)',
        // Border stays the ordinary colour while dragging — a tint carries
        // the "you can drop here" signal without the row jumping out. The
        // open row is the one exception: its tint has to survive scrolling
        // past twenty other rows, so it gets the stronger edge as well.
        // --color-accent is near-black and would read as an error state.
        border: `1px solid var(--color-border${selected ? '-strong' : ''})`,
        background: overRow || selected ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
        transition: 'background 120ms ease, border-color 120ms ease',
        // `start`, not `center`: centering pins the row to one line's height,
        // so a second section spills past the border instead of growing it.
        minHeight: '56px', alignItems: 'start',
      }}
    >
      {/* Just the name now. The all-shifts target moved onto each track's
          own timeline body, where it can say which track it means — the name
          speaks for every track at once, which on a two-day event is the one
          thing a drop must not be vague about. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0,
      }}>
        {/* eventName, not `name`: a catalog-linked event leaves its own
            name column null and carries it on the joined canonical event. */}
        <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: '13px' }}>
          {eventName(event)}
        </span>
        {display.division && event.division && (
          <Badge variant={divisionVariant(event.division)}>{event.division}</Badge>
        )}
        {display.type && event.event_type === 'trial' && <Badge variant="pending">Trial</Badge>}
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
                handlers={handlers}
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
          handlers={handlers}
        />
      )}
    </div>
  )
}
