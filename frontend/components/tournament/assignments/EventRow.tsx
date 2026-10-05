"use client";

import { useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'

import { MemberChip } from '@/components/tournament/assignments/MemberChip'
import { TrackSections } from '@/components/tournament/assignments/TrackSections'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
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
  event, rowAssignments, roleCatalog, flagsFor, activeTrackId, simple,
  selected, onOpen, handlers,
}: {
  event: TournamentEvent
  rowAssignments: Assignment[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
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
  /** Opens this event's panel from its name. Omitted for a viewer who can't
   *  manage events, which leaves the name as plain text. */
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

  // Only the name opens the panel — the whole rail did, and stray clicks
  // while working the board kept popping it open.
  const [nameHovered, setNameHovered] = useState(false)

  return (
    // The event names itself in a column of its own and hands the rest of the
    // row to its tracks. The name earns the rail: it is what the eye runs
    // down to find a row, and putting it on the same stack as the tracks
    // buried it under everything each track had to say.
    <div
      style={{
        // The list's own columns, not this row's: the name rail is shared by
        // every row (see the grid around them), so it is as wide as the
        // longest name rather than a fixed width most events leave half
        // empty. The row's padding comes out of the first and last track, so
        // the columns still line up row to row.
        display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid',
        columnGap: '8px',
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
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0,
          alignSelf: 'stretch', alignContent: 'flex-start', paddingTop: '2px',
        }}
      >
        {/* eventName, not `name`: a catalog-linked event leaves its own
            name column null and carries it on the joined canonical event. */}
        {onOpen ? (
          // Ghost Button stripped to plain text, so the name sits exactly
          // where the span did; an underline is the only hover cue.
          <Button
            type="button" variant="ghost" interactive={false}
            onClick={onOpen}
            onMouseEnter={() => setNameHovered(true)}
            onMouseLeave={() => setNameHovered(false)}
            title="Open event"
            style={{
              height: 'auto', padding: 0, border: 'none', textAlign: 'left', justifyContent: 'flex-start',
              fontWeight: 500, fontSize: '13px', letterSpacing: 'normal',
              textDecoration: nameHovered ? 'underline' : 'none', textUnderlineOffset: '2px',
            }}
          >
            {eventName(event)}
          </Button>
        ) : (
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: '13px' }}>
            {eventName(event)}
          </span>
        )}
        {event.division && (
          <Badge variant={divisionVariant(event.division)}>{event.division}</Badge>
        )}
        {event.event_type === 'trial' && <Badge variant="pending">Trial</Badge>}
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
          showTrackLabels={focusedTrackId === null}
          handlers={handlers}
        />
      )}
    </div>
  )
}
