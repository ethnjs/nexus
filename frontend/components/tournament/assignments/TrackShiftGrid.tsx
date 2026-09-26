"use client";

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'

import { MemberChip } from '@/components/tournament/assignments/MemberChip'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Assignment, Role, TournamentShift } from '@/lib/api'
import type { Flag } from '@/lib/assignments/flags'
import type { Lane } from '@/lib/assignments/lanes'
import type { BoardHandlers } from '@/lib/assignments/board'
import { formatTime } from '@/lib/timeFormat'

// The bar's own horizontal gutter, so two bars in neighbouring columns don't
// touch. Folded into the offsets below so a resize puts the chip's *border*
// under the cursor rather than the gutter outside it.
const BAR_GUTTER = 3
// A bar dragged past its own start stays a visible sliver instead of
// inverting. The span itself can't invert — handleResize anchors the far
// edge — so this only keeps the preview honest about that.
const MIN_BAR_WIDTH = 24

/** Where the dragged edge is right now, against the lane it was measured in. */
interface ResizePreview {
  edge: 'start' | 'end'
  /** Px across the lane, already adjusted for where the edge was grabbed. */
  x: number
  /** The lane's width at pointerdown — the grid can't be re-measured mid
   *  gesture without reading layout on every frame. */
  width: number
}

/**
 * Margins that stretch the bar to the cursor.
 *
 * The committed span still snaps a whole shift at a time; this is only what
 * the eye follows in between, so the two have to be drawn from the same
 * numbers — the offsets are measured against `first`/`last` as they stand on
 * *this* render, which is the span as already committed. A negative margin
 * lets the bar reach past the grid area it occupies, and that overhang is
 * the whole effect.
 */
function stretchToCursor(resize: ResizePreview, first: number, last: number, columns: number) {
  const colWidth = resize.width / columns
  const left = first * colWidth + BAR_GUTTER
  const right = (last + 1) * colWidth - BAR_GUTTER
  return resize.edge === 'end'
    ? { marginRight: right - Math.max(resize.x, left + MIN_BAR_WIDTH) }
    : { marginLeft: Math.min(resize.x, right - MIN_BAR_WIDTH) - left }
}

function TimelineBar({
  lane, eventId, columns, roleCatalog, flagsFor, handlers,
}: {
  lane: Lane
  eventId: number
  columns: number
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  handlers: BoardHandlers
}) {
  const first = Math.min(...lane.covered)
  const last = Math.max(...lane.covered)
  const [resize, setResize] = useState<ResizePreview | null>(null)

  // A raw pointer drag rather than a dnd-kit draggable: resizing changes how
  // far one bar reaches, not where it lives, and routing it through the drag
  // context would make every resize look like a reassignment to the drop
  // targets. Each move commits, so the chip grows under the cursor rather
  // than snapping when you let go.
  function startResize(edge: 'start' | 'end', e: ReactPointerEvent) {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    const track = handle.closest('[data-lane]')
    if (!track) return
    const rect = track.getBoundingClientRect()
    const colWidth = rect.width / columns

    // Where the border sits relative to the cursor at pointerdown. Carried
    // through the gesture so the border stays under the same part of the
    // cursor instead of jumping to it on the first move — the grip is 12px
    // wide, so grabbing its outer edge would otherwise shift the bar.
    const grabbedAt = edge === 'end'
      ? (last + 1) * colWidth - BAR_GUTTER
      : first * colWidth + BAR_GUTTER
    const grab = e.clientX - rect.left - grabbedAt
    const edgeAt = (clientX: number) =>
      Math.min(Math.max(clientX - rect.left - grab, 0), rect.width)

    // Capture retargets every later pointer event to the handle, so the drag
    // survives the cursor leaving the chip — and a release outside the window
    // still arrives as a pointerup instead of stranding the listeners.
    handle.setPointerCapture(e.pointerId)
    setResize({ edge, x: edgeAt(e.clientX), width: rect.width })

    // The cursor belongs to whatever sits under the pointer, which mid-resize
    // is rarely the chip. Lock it on <body>, and kill selection so dragging
    // back across the row doesn't highlight its text.
    const priorCursor = document.body.style.cursor
    const priorSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    let lastIndex = -1

    function move(ev: globalThis.PointerEvent) {
      const x = edgeAt(ev.clientX)
      // Every frame, so the border tracks the cursor between column
      // crossings — this is the only part of the gesture that moves at
      // pointer resolution.
      setResize({ edge, x, width: rect.width })
      // The column the border is now inside. Same position the preview
      // draws from, so the bar doesn't jump when the span catches up.
      const index = Math.max(0, Math.min(columns - 1, Math.floor(x / colWidth)))
      // Pointermove fires per frame; without this every one re-commits the
      // same span and rebuilds the whole rows array for nothing.
      if (index === lastIndex) return
      lastIndex = index
      handlers.onResize(lane.key, eventId, edge, index)
    }
    function up() {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      document.body.style.cursor = priorCursor
      document.body.style.userSelect = priorSelect
      // Dropping the preview snaps the bar onto the span that was committed
      // as the cursor crossed columns — the last thing the eye saw and the
      // thing that was actually written.
      setResize(null)
      // `lane.assignments` is exactly what the lane held before this
      // gesture's first pointermove — startResize closed over it once, at
      // pointerdown, and nothing since has changed which object it names.
      handlers.onResizeCommit(lane.key, eventId, lane.assignments)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <div
      style={{
        gridColumn: `${first + 1} / ${last + 2}`,
        minWidth: 0,
        padding: `0 ${BAR_GUTTER}px`,
        ...(resize ? stretchToCursor(resize, first, last, columns) : null),
      }}
    >
      <MemberChip
        lane={lane}
        eventId={eventId}
        roleCatalog={roleCatalog}
        flagsFor={flagsFor}
        handlers={handlers}
        onResizeStart={startResize}
        resizingEdge={resize?.edge ?? null}
      />
    </div>
  )
}/** One shift's full-height column. Invisible until a drag is over it, then
 *  the column itself tints — the target is the area you are already aiming
 *  at, not a separate band that has to be explained. */
function ShiftColumn({
  eventId, shiftId, first, allShifts,
}: { eventId: number; shiftId: number; first: boolean; allShifts: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `shift:${eventId}:${shiftId}`,
    data: { kind: 'shift', eventId, shiftId },
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        borderLeft: first ? 'none' : '1px solid var(--color-border)',
        // `allShifts` is the row's all-shifts target being hovered. It tints
        // every column because that is literally what dropping there does —
        // showing the preview only on the metadata block asked you to take
        // its word for it.
        background: isOver || allShifts ? 'var(--color-accent-subtle)' : 'transparent',
        transition: 'background 120ms ease',
      }}
    />
  )
}

/**
 * One track's own grid: its shift columns, the time/name header above them,
 * and the bars on it. Split out of ShiftTimeline so an event running on
 * several tracks can repeat this once per track instead of drawing one grid
 * whose columns silently jump from one track's day to another's.
 */
export function TrackShiftGrid({
  eventId, shifts, lanes, roleCatalog, flagsFor, handlers, overAllShifts,
}: {
  eventId: number
  shifts: TournamentShift[]
  lanes: Lane[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  handlers: BoardHandlers
  /** The row's all-shifts target is being hovered. */
  overAllShifts: boolean
}) {
  const columns = shifts.length
  const gridColumns = `repeat(${columns}, minmax(0, 1fr))`
  // One time at every divider, edges included — n shifts have n+1 boundaries,
  // and each internal one is both a shift's end and the next one's start.
  const boundaries = [shifts[0].start, ...shifts.map((s) => s.end)]

  return (
    <div style={{
      position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0,
    }}>
      {/* The columns are both the dividers and the drop targets, drawn once as
          a layer behind everything so they run the full height of the lanes.
          Per-lane borders never line up, and a separate strip of drop zones
          made you aim somewhere other than where the shift is. */}
      <div
        style={{
          position: 'absolute', inset: 0, display: 'grid',
          gridTemplateColumns: gridColumns,
        }}
      >
        {shifts.map((shift, i) => (
          <ShiftColumn
            key={shift.id}
            eventId={eventId}
            shiftId={shift.id}
            first={i === 0}
            allShifts={overAllShifts}
          />
        ))}
      </div>

      {/* Times and shift names share one line: they name the same axis, and
          stacking them cost a whole row of header to say it twice. They can
          share because they never want the same x — a name is centred in its
          column, a time sits on the divider *between* columns, so each falls
          in the other's gap. The times are absolutely positioned (out of the
          grid's flow) rather than being cells of it, since a boundary belongs
          to no single column.

          One time per divider — a boundary is shared by the shift before and
          after it, so printing it once says what two per-column ranges said
          redundantly. Every time sits to the *right* of its line, so each
          reads as "this column starts at"; the last boundary has no column
          after it, so it flips to the left. */}
      <div style={{
        position: 'relative', pointerEvents: 'none',
        display: 'grid', gridTemplateColumns: gridColumns,
        borderBottom: '1px solid var(--color-border)', paddingBottom: '4px',
      }}>
        {boundaries.map((moment, i) => (
          <span
            key={i}
            style={{
              position: 'absolute', left: `${(i / columns) * 100}%`, top: '50%',
              // translateY centres it against the taller shift name beside it;
              // the last one also pulls itself back inside the right edge.
              transform: i === columns ? 'translate(-100%, -50%)' : 'translateY(-50%)',
              paddingLeft: i === columns ? 0 : '4px',
              paddingRight: i === columns ? '4px' : 0,
              fontFamily: 'var(--font-sans)', fontSize: '10px',
              color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap',
            }}
          >
            {formatTime(moment)}
          </span>
        ))}
        {shifts.map((shift) => (
          <span key={shift.id} style={{
            fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 500,
            color: 'var(--color-text-secondary)', textAlign: 'center',
            padding: '0 6px', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {shift.label}
          </span>
        ))}
      </div>

      {lanes.length === 0 && (
        // Empty means empty *here*: this is the timeline, so it reports on
        // the shifts alone. People in the cosmetic-track columns below are
        // not on a shift, and counting them as staffing would leave an event
        // whose competition days are unstaffed looking covered.
        //
        // Sits above the column layer so the dividers don't strike through
        // it, and spans the row so an unstaffed event reads as a gap in the
        // board rather than as a stray line of text.
        <div style={{ position: 'relative' }}>
          <EmptyState size="sm" title="Nobody assigned" />
        </div>
      )}

      {lanes.map((lane) => (
        <div
          key={lane.key}
          data-lane
          style={{ position: 'relative', display: 'grid', gridTemplateColumns: gridColumns }}
        >
          <TimelineBar
            lane={lane}
            eventId={eventId}
            columns={columns}
            roleCatalog={roleCatalog}
            flagsFor={flagsFor}
            handlers={handlers}
          />
        </div>
      ))}
    </div>
  )
}
