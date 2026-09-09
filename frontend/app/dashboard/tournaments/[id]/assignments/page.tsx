'use client'

/**
 * Assignments board.
 *
 * Layout: event rows own the page and its scroll. The unassigned member belt
 * is a DockedPanel in the shell's panel slot, and clicking a card opens a
 * second DockedPanel beside it with that member's full record.
 *
 * Each event row's people area is a horizontal timeline — one column per
 * shift, and a bar per person spanning the shifts they cover. Worth knowing
 * how that maps to the API: an assignment row holds ONE shift, so a bar
 * covering three shifts is three assignment rows sharing a membership_role.
 * Resizing a bar adds or removes rows; it does not edit a span.
 *
 * Writes: every mutation (drag, resize, role toggle, remove) updates local
 * state first and syncs to assignmentsApi after — see createAssignmentRow /
 * deleteAssignmentRow and the lane-diff helpers below. A row not yet
 * confirmed by the server carries a negative id (see nextLocalId) so a
 * handler can always tell "real" from "still in flight" without a second
 * bookkeeping structure.
 */
import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { useParams } from 'next/navigation'
import {
  useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core'

import { DockedPanel } from '@/components/layout/DockedPanel'

import { useBoardDragging, useRegisterBoardDnd } from '@/components/assignments/BoardDnd'
import { MemberPanel, MEMBER_PANEL_WIDTH } from '@/components/tournament/MemberPanel'
import {
  MembersFilterModal, emptyMembersFilter, isMembersFilterActive,
  membersFilterFromStored, membersFilterToStored,
  type MembersFilterState,
} from '@/components/tournament/MembersFilterModal'
import {
  EventsFilterModal, EVENTS_FILTER_KEYS, EVENT_FILTER_UNSET, EVENT_TYPE_OPTIONS,
  eventCategoryKey, eventCategoryOptions, eventsFilterFromStored,
  eventsFilterToStored, isEventsFilterActive,
  type EventsFilterState,
} from '@/components/tournament/events/EventsFilterModal'
import { emptyFilterState, filterAllows } from '@/components/ui/FilterModal'
import { useMemberRoleLock } from '@/lib/roles/useMemberRoleLock'
import { useAuth } from '@/lib/useAuth'
import { useMyMembership } from '@/lib/useMyMembership'
import { useTournament } from '@/lib/useTournament'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  IconClock, IconEvents, IconEye, IconFilter, IconLocation, IconLock,
  IconSearch, IconUser, IconWarning, IconX,
} from '@/components/ui/Icons'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { PillMenu } from '@/components/ui/PillMenu'
import { Spinner } from '@/components/ui/Spinner'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  ApiError, assignmentsApi, displayConfigApi, membersApi, rolesApi, tournamentEventsApi,
  tournamentShiftsApi, tournamentTracksApi,
  type Assignment, type MembershipFull, type Role, type TournamentEvent,
  type TournamentShift, type TournamentTrack,
} from '@/lib/api'
import {
  assignmentFlags,
  assignmentsByEvent,
  memberFacts,
  type Flag,
} from '@/lib/assignments/flags'
import { persistDisplayConfigSurface } from '@/lib/displayConfig'
import { ASSIGNMENT_CARD, ASSIGNMENTS_EVENTS } from '@/lib/displayConfigSurfaces'
import { formatTime } from '@/lib/timeFormat'
import { useSetLayoutPanel } from '@/lib/useLayoutPanel'
import { useToast } from '@/lib/useToast'

import {
  DEFAULT_EVENT_DISPLAY, EventDisplayModal, eventDisplayFromColumns,
  eventDisplayToColumns, type EventDisplayState,
} from '@/components/assignments/EventDisplayModal'
import {
  DEFAULT_MEMBER_DISPLAY, MemberDisplayModal, memberDisplayFromHidden,
  memberDisplayToHidden, type MemberDisplayState,
} from '@/components/assignments/MemberDisplayModal'
import { MemberCard } from '@/components/assignments/MemberCard'

type AssignmentRole = Assignment['role']

type DragListeners = ReturnType<typeof useDraggable>['listeners']

/**
 * `grabbing` from the moment the pointer goes down.
 *
 * dnd-kit's `isDragging` only turns true once the PointerSensor's 4px
 * threshold is crossed, so keying the cursor off it leaves the hand open
 * through the whole press-and-hesitate that precedes most drags. The release
 * is watched on `window` because the pointer is usually somewhere else by
 * then — that is the entire point of a drag.
 *
 * Takes dnd-kit's `listeners` and calls through to them, because
 * `{...listeners}` already sets onPointerDown: a second onPointerDown prop
 * beside the spread replaces it outright and silently kills the drag. Passing
 * them in keeps that composition in one place rather than at each call site.
 */
function useGrabCursor(listeners: DragListeners) {
  const [pressed, setPressed] = useState(false)

  function onPointerDown(e: ReactPointerEvent) {
    setPressed(true)
    const release = () => {
      setPressed(false)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    listeners?.onPointerDown?.(e)
  }

  return { pressed, onPointerDown }
}

/** PersonRole.id is nullable — a role can be a free-text label with no
 *  catalog row behind it — so identity falls back to the label. Every role
 *  this board creates comes from the catalog (numeric id), so this only ever
 *  matters for reading existing assignments. */
function roleKey(role: AssignmentRole): string {
  return role.id === null ? `label:${role.label}` : `id:${role.id}`
}

function sameRole(a: AssignmentRole, b: AssignmentRole): boolean {
  return roleKey(a) === roleKey(b)
}

/** The distinct roles a set of rows carries, in a stable order so the pill's
 *  summary doesn't reshuffle every time rows are rebuilt. */
function rolesOf(rows: Assignment[]): AssignmentRole[] {
  const seen = new Map<string, AssignmentRole>()
  for (const row of rows) {
    const key = roleKey(row.role)
    if (!seen.has(key)) seen.set(key, row.role)
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}
// Narrower than the member panel: a card is a name, a line of experience and
// a few preference badges, and giving it more width just stretches the badges.
const BELT_PANEL_WIDTH = 340

function fullName(member: { first_name: string | null; last_name: string | null }) {
  return [member.first_name, member.last_name].filter(Boolean).join(' ')
}

function divisionVariant(division: string | null) {
  if (division === 'A') return 'divisionA' as const
  if (division === 'B') return 'divisionB' as const
  return 'divisionC' as const
}


/**
 * The same event with its shifts in schedule order.
 *
 * The board reads `shifts` as the timeline itself — the array index is the
 * column, a bar's span is a slice of it, and the boundary times are its
 * starts and ends — so an event whose Impound shift was attached after
 * Morning printed the day as 8am, 12pm, 4pm, 8am. The API sorts these now
 * (TournamentEvent.shifts order_by), and this normalises on arrival anyway:
 * every ordering assumption downstream is local to this page, so this is
 * where it should be guaranteed rather than assumed.
 */
function withOrderedShifts(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    shifts: [...event.shifts].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.id - b.id,
    ),
  }
}

/** An event's shiftless tracks. `is_primary` is the whole test: only a
 *  primary track has dates, and only a dated track can hold shifts (see
 *  TournamentTrack in models.py), so a cosmetic one can never be a column. */
function cosmeticTracksOf(event: TournamentEvent): TournamentTrack[] {
  return event.tracks.filter((track) => !track.is_primary)
}


/** A hover-revealed icon button inside a chip. Hidden from the pointer while
 *  invisible, not merely transparent — otherwise a stray click on a chip you
 *  were only passing over hits a control you cannot see. */
function ChipAction({
  hovered, danger, onClick, title, label, children,
}: {
  hovered: boolean
  danger?: boolean
  onClick: () => void
  title: string
  label: string
  children: ReactNode
}) {
  const resting = 'var(--color-text-tertiary)'
  const active = danger ? 'var(--color-danger)' : 'var(--color-text-primary)'
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, padding: 0, width: '14px', height: '14px',
        border: 'none', background: 'transparent', borderRadius: '3px',
        color: resting, cursor: 'pointer',
        opacity: hovered ? 1 : 0,
        pointerEvents: hovered ? 'auto' : 'none',
        transition: 'opacity 120ms ease, color 120ms ease',
      }}
      onPointerEnter={(e) => { e.currentTarget.style.color = active }}
      onPointerLeave={(e) => { e.currentTarget.style.color = resting }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Chip — one assigned person. Name only.
// ---------------------------------------------------------------------------
function Chip({
  assignment, roles, roleCatalog, onToggleRole, onRemove, flags, onResizeStart, resizingEdge,
}: {
  assignment: Assignment
  /** Every role this person holds on the event — the lane's roles, not the
   *  one row's, since a lane is one row per shift *per role*. */
  roles: AssignmentRole[]
  /** Every role the tournament offers, for the pill's picker. */
  roleCatalog: Role[]
  onToggleRole: (role: AssignmentRole) => void
  /** Drops the whole bar — every shift, every role. */
  onRemove: () => void
  flags: Flag[]
  /** Given, the chip grows its own resize edges — no separate handles. */
  onResizeStart?: (edge: 'start' | 'end', e: ReactPointerEvent) => void
  /** Which edge is mid-drag, so its grip stays lit once the cursor has
   *  outrun the chip. */
  resizingEdge?: 'start' | 'end' | null
}) {
  const [hovered, setHovered] = useState(false)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip:${assignment.id}`,
    data: { kind: 'chip', assignment },
  })
  const grab = useGrabCursor(listeners)

  // The edges live inside the chip and sit above the drag listeners.
  // stopPropagation is what keeps a resize from also starting a drag — the
  // pointerdown would otherwise bubble to the draggable root.
  const edge = (side: 'start' | 'end') => {
    const active = resizingEdge === side
    return (
      <div
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart?.(side, e) }}
        title={side === 'start' ? 'Drag to start earlier' : 'Drag to extend'}
        style={{
          position: 'absolute', top: 0, bottom: 0, width: '12px',
          [side === 'start' ? 'left' : 'right']: 0,
          cursor: 'ew-resize',
          // Touch hands a horizontal drag to the scroller unless the element
          // claims it, and the resize would never see a pointermove.
          touchAction: 'none',
          display: 'flex', alignItems: 'center',
          justifyContent: side === 'start' ? 'flex-start' : 'flex-end',
          padding: '0 3px',
        }}
      >
        {/* An invisible hit zone is a feature nobody finds. The grip shows on
            hover only, so a settled board stays quiet. */}
        <div style={{
          width: '2px', height: '11px', borderRadius: '1px',
          background: active ? 'var(--color-accent)' : 'var(--color-border-strong)',
          opacity: active || hovered ? 1 : 0,
          transition: 'opacity 120ms ease, background 120ms ease',
        }} />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={grab.onPointerDown}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: '6px',
        // Horizontal padding clears the 12px grips, so the name never sits
        // under a hit zone on a chip narrowed to a single shift.
        padding: '4px 14px', borderRadius: 'var(--radius-md)',
        border: `1px solid ${flags.length ? 'var(--color-warning)' : 'var(--color-border)'}`,
        background: flags.length ? 'var(--color-warning-subtle)' : 'var(--color-surface)',
        fontSize: '12px', cursor: grab.pressed || isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        // dnd-kit makes a draggable focusable, so grabbing one paints the
        // browser's default focus ring — the black outline. Dragging already
        // has its own visual state; the ring only adds a hard edge.
        outline: 'none',
        // No `overflow: hidden` here — it clipped the warning tooltip, which
        // renders inside the chip. The name below does its own truncating.
        minWidth: 0,
      }}
    >
      {onResizeStart && edge('start')}
      {/* The shift is carried by where the bar sits on the timeline, so
          repeating it here would say the same thing twice and cost the width
          that makes the name readable. */}
      <span style={{
        fontFamily: 'var(--font-sans)', fontWeight: 500, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
      }}>
        {fullName(assignment.member)}
      </span>
      {/* stopPropagation for the same reason the resize edges do it: without
          it, pressing the pill starts a dnd-kit drag of the whole chip and the
          menu never opens. flexShrink pins the pill at full size so a chip
          narrowed to one shift eats into the name instead of the control. */}
      <span
        onPointerDown={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexShrink: 0, cursor: 'default' }}
      >
        <PillMenu
          label={roleSummary(roles)}
          tone={roles.length > 0 ? 'default' : 'muted'}
          items={roleCatalog}
          getKey={(role) => role.id}
          renderLabel={(role) => role.label}
          checklist
          isSelected={(role) => roles.some((r) => sameRole(r, role))}
          // Clearing the last role would delete the assignment outright — a
          // menu that says "roles" should not be able to unassign someone.
          isDisabled={(role) => roles.length === 1 && sameRole(roles[0], role)}
          disabledReason={() => 'Add another role before removing this one'}
          onSelect={onToggleRole}
          width={200}
          align="left"
        />
      </span>
      {flags.length > 0 && (
        <Tooltip variant="warning" message={flags.map((f) => f.detail).join(' ')} showIcon={false}>
          <span style={{ display: 'flex', color: 'var(--color-warning)' }}>
            <IconWarning size={12} />
          </span>
        </Tooltip>
      )}
      {/* Only on hover: a board of forty chips each wearing a permanent × is
          forty invitations to delete something. stopPropagation on pointerdown
          so pressing it doesn't start a drag, and the click is what fires. */}
      <ChipAction
        hovered={hovered}
        danger
        onClick={onRemove}
        title="Remove from this event"
        label={`Remove ${fullName(assignment.member)} from this event`}
      >
        <IconX size={10} />
      </ChipAction>
      {onResizeStart && edge('end')}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shift timeline
// ---------------------------------------------------------------------------
export interface Lane {
  key: string
  assignments: Assignment[]
  /** Indices into the event's shift list that this person covers. */
  covered: number[]
  /** Every distinct role the lane's rows carry. */
  roles: AssignmentRole[]
}

/** A bar's identity: one member on one event. Roles used to be part of the
 *  key — writing and reviewing the same event were two bars. Now a bar owns
 *  a *set* of roles, so the lane is one row per shift per role and the person
 *  gets one chip with two role pills instead of two stacked chips. */
function laneKeyOf(assignment: Assignment) {
  return String(assignment.member.membership_id)
}

function buildLanes(rowAssignments: Assignment[], shiftIds: number[]) {
  const pinned = new Map<string, Assignment[]>()
  const loose = new Map<string, Assignment[]>()

  for (const assignment of rowAssignments) {
    const index = assignment.shift ? shiftIds.indexOf(assignment.shift.id) : -1
    const into = index === -1 ? loose : pinned
    const key = laneKeyOf(assignment)
    const list = into.get(key)
    if (list) list.push(assignment)
    else into.set(key, [assignment])
  }

  const toLanes = (grouped: Map<string, Assignment[]>): Lane[] =>
    [...grouped.entries()].map(([key, rows]) => ({
      key,
      assignments: rows,
      // Distinct, because the same shift now appears once per role.
      covered: [...new Set(
        rows.map((row) => (row.shift ? shiftIds.indexOf(row.shift.id) : -1)),
      )].filter((i) => i >= 0),
      roles: rolesOf(rows),
    }))

  return { lanes: toLanes(pinned), unpinned: toLanes(loose) }
}

/** The pill's own text. One role names itself; several would overflow a chip
 *  that may be one column wide, so the rest are a count the menu spells out. */
function roleSummary(roles: AssignmentRole[]): string {
  if (roles.length === 0) return 'Role'
  if (roles.length === 1) return roles[0].label
  return `${roles[0].label} +${roles.length - 1}`
}

/** One message per distinct warning. A lane is one assignment row per shift,
 *  so flagging each row repeats "not available for Sun afternoon" once per
 *  shift the bar covers — which is what made the tooltip a paragraph. */
function laneFlags(lane: Lane, flagsFor: (a: Assignment) => Flag[]): Flag[] {
  const seen = new Map<string, Flag>()
  for (const flag of lane.assignments.flatMap(flagsFor)) {
    if (!seen.has(flag.detail)) seen.set(flag.detail, flag)
  }
  return [...seen.values()]
}

function TimelineBar({
  lane, eventId, columns, roleCatalog, flagsFor, onResize, onResizeCommit, onToggleRole, onRemove,
}: {
  lane: Lane
  eventId: number
  columns: number
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  onResize: (laneKey: string, eventId: number, edge: 'start' | 'end', index: number) => void
  /** Fires once, on release — syncs the whole gesture's net change to the
   *  server rather than one write per pointermove. `beforeRows` is the
   *  lane's rows as of pointerdown (see the closure note on startResize). */
  onResizeCommit: (laneKey: string, eventId: number, beforeRows: Assignment[]) => void
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onRemove: (laneKey: string, eventId: number) => void
}) {
  const first = Math.min(...lane.covered)
  const last = Math.max(...lane.covered)
  const flags = laneFlags(lane, flagsFor)
  const [resizingEdge, setResizingEdge] = useState<'start' | 'end' | null>(null)

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

    // Capture retargets every later pointer event to the handle, so the drag
    // survives the cursor leaving the chip — and a release outside the window
    // still arrives as a pointerup instead of stranding the listeners.
    handle.setPointerCapture(e.pointerId)
    setResizingEdge(edge)

    // The cursor belongs to whatever sits under the pointer, which mid-resize
    // is rarely the chip. Lock it on <body>, and kill selection so dragging
    // back across the row doesn't highlight its text.
    const priorCursor = document.body.style.cursor
    const priorSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    let lastIndex = -1

    function move(ev: globalThis.PointerEvent) {
      const raw = Math.floor((ev.clientX - rect.left) / colWidth)
      const index = Math.max(0, Math.min(columns - 1, raw))
      // Pointermove fires per frame; without this every one re-commits the
      // same span and rebuilds the whole rows array for nothing.
      if (index === lastIndex) return
      lastIndex = index
      onResize(lane.key, eventId, edge, index)
    }
    function up() {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      document.body.style.cursor = priorCursor
      document.body.style.userSelect = priorSelect
      setResizingEdge(null)
      // `lane.assignments` is exactly what the lane held before this
      // gesture's first pointermove — startResize closed over it once, at
      // pointerdown, and nothing since has changed which object it names.
      onResizeCommit(lane.key, eventId, lane.assignments)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <div style={{ gridColumn: `${first + 1} / ${last + 2}`, minWidth: 0, padding: '0 3px' }}>
      <Chip
        assignment={lane.assignments[0]}
        roles={lane.roles}
        roleCatalog={roleCatalog}
        onToggleRole={(role) => onToggleRole(lane.key, eventId, role)}
        onRemove={() => onRemove(lane.key, eventId)}
        flags={flags}
        onResizeStart={startResize}
        resizingEdge={resizingEdge}
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
 * Memoised: EventRow above calls useDroppable, so it re-renders every time
 * the drag crosses into a different target — twenty-five rows rebuilding
 * their lanes, chips and flags per crossing. The row's droppable state that
 * this subtree actually needs is `overAllShifts`, which only moves for the
 * one row being hovered; everything else it takes is stable while dragging,
 * so the other rows now bail out here.
 */
const ShiftTimeline = memo(function ShiftTimeline({
  event, rowAssignments, roleCatalog, flagsFor, onResize, onResizeCommit, onToggleRole, onRemove, overAllShifts,
}: {
  event: TournamentEvent
  rowAssignments: Assignment[]
  roleCatalog: Role[]
  onRemove: (laneKey: string, eventId: number) => void
  /** The row's all-shifts target is being hovered. */
  overAllShifts: boolean
  flagsFor: (a: Assignment) => Flag[]
  onResize: (laneKey: string, eventId: number, edge: 'start' | 'end', index: number) => void
  onResizeCommit: (laneKey: string, eventId: number, beforeRows: Assignment[]) => void
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
}) {
  const shiftIds = event.shifts.map((s) => s.id)
  const { lanes, unpinned } = buildLanes(rowAssignments, shiftIds)
  // Any drag in flight, from the belt or from another chip. Our own context,
  // not useDndContext — see the note on useBoardDragging.
  const dragging = useBoardDragging()
  const columns = event.shifts.length
  const gridColumns = `repeat(${columns}, minmax(0, 1fr))`
  const cosmeticTracks = cosmeticTracksOf(event)

  // One time at every divider, edges included — n shifts have n+1 boundaries,
  // and each internal one is both a shift's end and the next one's start.
  const boundaries = [event.shifts[0].start, ...event.shifts.map((s) => s.end)]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
      {/* Everything the columns apply to, and nothing else — the layer below
          is `inset: 0` against *this* box, so the No-shift section being a
          sibling rather than a child is what keeps the dividers from running
          down through it. Those people are on no column by definition. */}
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
        {event.shifts.map((shift, i) => (
          <ShiftColumn
            key={shift.id}
            eventId={event.id}
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
        {event.shifts.map((shift) => (
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
            eventId={event.id}
            columns={columns}
            roleCatalog={roleCatalog}
            flagsFor={flagsFor}
            onResize={onResize}
            onResizeCommit={onResizeCommit}
            onToggleRole={onToggleRole}
            onRemove={onRemove}
          />
        </div>
      ))}

      {/* Normally only when somebody is actually unpinned — an always-present
          empty section is chrome explaining a state that isn't happening. But
          its columns are the only targets a cosmetic track has, and a target
          that only exists once you have already used it is not reachable by
          dragging. So it also appears, empty, for the duration of a drag. */}
      </div>

      {(unpinned.length > 0 || (dragging && cosmeticTracks.length > 0)) && (
        <UnpinnedSection
          eventId={event.id}
          unpinned={unpinned}
          cosmeticTracks={cosmeticTracks}
          roleCatalog={roleCatalog}
          flagsFor={flagsFor}
          onToggleRole={onToggleRole}
          onRemove={onRemove}
        />
      )}
    </div>
  )
})

/**
 * One cosmetic track's share of the no-shift area: its people, and the target
 * that puts more of them there.
 *
 * A cosmetic track (is_primary false — Test Writing, Review) has no shifts by
 * construction, so it can never be a timeline column; before this it had no
 * area of its own at all, and a drop anywhere on the event granted
 * `tracks[0]`'s default role. On an event that runs on both Day 1 and Test
 * Writing that is simply the wrong role, with nothing on screen to say so.
 *
 * The role is named in the header rather than left to be discovered after the
 * drop, since granting it is the whole point of aiming at this column.
 */
function TrackColumn({ eventId, track, lanes, roleCatalog, flagsFor, onToggleRole, onRemove }: {
  eventId: number
  track: TournamentTrack
  lanes: Lane[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onRemove: (laneKey: string, eventId: number) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `track:${eventId}:${track.id}`,
    data: { kind: 'track', eventId, trackId: track.id },
  })
  const role = track.default_role_id === null
    ? null
    : roleCatalog.find((r) => r.id === track.default_role_id) ?? null

  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0,
        padding: '6px 8px', borderRadius: 'var(--radius-sm)',
        border: `1px solid ${isOver ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: isOver ? 'var(--color-accent-subtle)' : 'transparent',
        // Tall enough to be aimed at while empty — this is the only way onto
        // a cosmetic track, so it cannot be a hairline.
        minHeight: '58px',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
          letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {track.name} · {lanes.length}
        </span>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: '10px', whiteSpace: 'nowrap',
          // A track with no default role still takes drops: the failure names
          // the track, which is more use than a column you cannot aim at and
          // cannot ask why.
          color: role ? 'var(--color-text-tertiary)' : 'var(--color-warning)',
        }}>
          {role ? role.label : 'No default role'}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {lanes.map((lane) => (
          <Chip
            key={lane.key}
            assignment={lane.assignments[0]}
            roles={lane.roles}
            roleCatalog={roleCatalog}
            onToggleRole={(role) => onToggleRole(lane.key, eventId, role)}
            onRemove={() => onRemove(lane.key, eventId)}
            flags={laneFlags(lane, flagsFor)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Which column an unpinned chip sits in.
 *
 * An assignment row carries no track — only event, member, role and shift —
 * so its role is the one signal there is: a chip sits under the track whose
 * default role it holds. Anything else (a role picked by hand, or two tracks
 * sharing a default) falls to the first column rather than vanishing. The
 * durable fix is a track on the assignment row itself, which is a migration.
 */
function bucketByTrack(lanes: Lane[], tracks: TournamentTrack[]): Map<number, Lane[]> {
  const buckets = new Map(tracks.map((track) => [track.id, [] as Lane[]]))
  for (const lane of lanes) {
    const owner = tracks.find((track) => track.default_role_id !== null
      && lane.roles.some((role) => role.id === track.default_role_id))
    buckets.get(owner?.id ?? tracks[0].id)!.push(lane)
  }
  return buckets
}

/** The no-shift area, split into one equal column per cosmetic track. Equal
 *  because nothing ranks them — an event's cosmetic tracks are parallel
 *  workstreams, not a hierarchy — and they divide the people area exactly,
 *  which is the row's width less the metadata column. */
function NoShiftTracks({ eventId, tracks, lanes, roleCatalog, flagsFor, onToggleRole, onRemove }: {
  eventId: number
  tracks: TournamentTrack[]
  lanes: Lane[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onRemove: (laneKey: string, eventId: number) => void
}) {
  if (tracks.length === 0) return null
  const buckets = bucketByTrack(lanes, tracks)
  return (
    <div style={{
      display: 'grid', gap: '6px',
      gridTemplateColumns: `repeat(${tracks.length}, minmax(0, 1fr))`,
    }}>
      {tracks.map((track) => (
        <TrackColumn
          key={track.id}
          eventId={eventId}
          track={track}
          lanes={buckets.get(track.id) ?? []}
          roleCatalog={roleCatalog}
          flagsFor={flagsFor}
          onToggleRole={onToggleRole}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

/**
 * Assigned to the event but pinned to no shift — test writing, and anything
 * not yet scheduled. Its own section because these are exactly the people a
 * TD needs to find and drag up onto a column.
 *
 * The section has no target of its own: it is exactly the event's cosmetic
 * tracks, one column each. A generic "no shift" drop is what used to grant
 * `tracks[0]`'s role with nothing on screen naming the track it billed, so
 * removing it removes the only way to land in that state by accident. The
 * cost is that an event with no cosmetic track can no longer be given an
 * unpinned assignment from the board — its columns are what a drop is for.
 * Existing unpinned people on such an event still show, read-only as a
 * placement: they are still draggable up onto a shift.
 */
function UnpinnedSection({
  eventId, unpinned, cosmeticTracks, roleCatalog, flagsFor, onToggleRole, onRemove,
}: {
  eventId: number
  unpinned: Lane[]
  /** The event's shiftless tracks — the section's columns, in event order. */
  cosmeticTracks: TournamentTrack[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onRemove: (laneKey: string, eventId: number) => void
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '6px',
      marginTop: '2px', paddingTop: '6px',
      borderTop: '1px solid var(--color-border)',
    }}>
      {cosmeticTracks.length > 0 ? (
        <NoShiftTracks
          eventId={eventId}
          tracks={cosmeticTracks}
          lanes={unpinned}
          roleCatalog={roleCatalog}
          flagsFor={flagsFor}
          onToggleRole={onToggleRole}
          onRemove={onRemove}
        />
      ) : (
        <>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
          }}>
            No shift · {unpinned.length}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {unpinned.map((lane) => (
              <Chip
                key={lane.key}
                assignment={lane.assignments[0]}
                roles={lane.roles}
                roleCatalog={roleCatalog}
                onToggleRole={(role) => onToggleRole(lane.key, eventId, role)}
                onRemove={() => onRemove(lane.key, eventId)}
                flags={laneFlags(lane, flagsFor)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MetaLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: '5px',
      fontFamily: 'var(--font-sans)', fontSize: '11px',
      color: 'var(--color-text-tertiary)',
    }}>
      {icon}
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------
function EventRow({
  event, rowAssignments, roleCatalog, flagsFor, display, onResize, onResizeCommit, onToggleRole, onRemove,
}: {
  event: TournamentEvent
  rowAssignments: Assignment[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  display: EventDisplayState
  onResize: (laneKey: string, eventId: number, edge: 'start' | 'end', index: number) => void
  onResizeCommit: (laneKey: string, eventId: number, beforeRows: Assignment[]) => void
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  onRemove: (laneKey: string, eventId: number) => void
}) {
  // Two targets on a row with shifts: the metadata column means "every
  // shift", and each timeline column means that one. The row itself is only a
  // target when there are no shifts to aim at.
  const { setNodeRef: setAllShiftsRef, isOver: overAllShifts } = useDroppable({
    id: `allday:${event.id}`,
    data: { kind: 'allday', eventId: event.id },
  })
  // The row is a target only for an event with neither shifts to aim at nor
  // cosmetic tracks to split by — anything else has a more specific target.
  const cosmeticTracks = cosmeticTracksOf(event)
  const { setNodeRef: setRowRef, isOver: overRow } = useDroppable({
    id: `event:${event.id}`,
    data: { kind: 'event', eventId: event.id },
    disabled: event.shifts.length > 0 || cosmeticTracks.length > 0,
  })


  const location = [event.building, event.room].filter(Boolean).join(' ')
  // The event's window: earliest shift start to latest shift end. Derived,
  // not stored — an event has no times of its own, only the union of the
  // shifts attached to it (see TournamentEvent in models.py).
  const starts = event.shifts.map((s) => s.start).sort()
  const ends = event.shifts.map((s) => s.end).sort()
  const span = event.shifts.length > 0
    ? `${formatTime(starts[0])} – ${formatTime(ends[ends.length - 1])}`
    : null
  const trackNames = event.tracks.map((t) => t.name)

  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '220px 1fr', gap: '12px',
        padding: '10px 12px', borderRadius: 'var(--radius-md)',
        // Border stays the ordinary colour while dragging — a tint carries
        // the "you can drop here" signal without the row jumping out.
        border: '1px solid var(--color-border)',
        background: overRow ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
        transition: 'background 120ms ease',
        // A row you cannot aim at is not a drop target. `start`, not `center`:
        // centering pins the row to one line's height, so a second lane spills
        // past the border instead of growing it.
        minHeight: '56px', alignItems: 'start',
      }}
    >
      <div
        ref={event.shifts.length > 0 ? setAllShiftsRef : undefined}
        style={{
          display: 'flex', flexDirection: 'column', gap: '4px',
          position: 'relative', borderRadius: 'var(--radius-sm)',
          padding: '2px 4px', margin: '-2px -4px',
          background: overAllShifts ? 'var(--color-accent-subtle)' : 'transparent',
          transition: 'background 120ms ease',
        }}
      >
        {/* Says what dropping here does, and only while it would do it. */}
        {overAllShifts && event.shifts.length > 0 && (
          <span style={{
            position: 'absolute', right: '4px', top: '2px',
            fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
            color: 'var(--color-accent)',
          }}>
            All shifts
          </span>
        )}
        {/* Name in sans and first — it is what you scan the column for. The
            division trails it as a tag rather than leading, so the names line
            up on the left edge instead of being indented by a badge. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: '13px' }}>
            {event.name}
          </span>
          {display.division && event.division && (
            <Badge variant={divisionVariant(event.division)}>{event.division}</Badge>
          )}
          {display.type && event.event_type === 'trial' && <Badge variant="pending">Trial</Badge>}
        </div>

        {/* Icon + text per line, so the kinds stay distinguishable without
            labels. Sans, not mono: these read as prose, not as data. */}
        {display.room && location && (
          <MetaLine icon={<IconLocation size={12} />}>{location}</MetaLine>
        )}
        {display.time && span && (
          <MetaLine icon={<IconClock size={12} />}>{span}</MetaLine>
        )}
        {display.tracks && trackNames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
            {trackNames.map((name) => <Badge key={name} variant="default">{name}</Badge>)}
          </div>
        )}
      </div>

      {event.shifts.length === 0 ? (
        // No shifts to lay a timeline over — test writing and friends. The
        // whole people area is the no-shift area here, so it is split the
        // same way: one column per cosmetic track.
        cosmeticTracks.length > 0 ? (
          <NoShiftTracks
            eventId={event.id}
            tracks={cosmeticTracks}
            lanes={buildLanes(rowAssignments, []).unpinned}
            roleCatalog={roleCatalog}
            flagsFor={flagsFor}
            onToggleRole={onToggleRole}
            onRemove={onRemove}
          />
        ) : (
          // No cosmetic track to split by, so the row itself stays the
          // target — the alternative is an event nothing can be assigned to.
          <div ref={setRowRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {rowAssignments.length === 0 ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <EmptyState size="sm" title="Nobody assigned" />
              </div>
            ) : (
              // No shifts to index against, so every row lands in `unpinned` —
              // which is the grouping we want anyway: one chip per person,
              // carrying however many roles they hold here.
              buildLanes(rowAssignments, []).unpinned.map((lane) => (
                <Chip
                  key={lane.key}
                  assignment={lane.assignments[0]}
                  roles={lane.roles}
                  roleCatalog={roleCatalog}
                  onToggleRole={(role) => onToggleRole(lane.key, event.id, role)}
                  onRemove={() => onRemove(lane.key, event.id)}
                  flags={laneFlags(lane, flagsFor)}
                />
              ))
            )}
          </div>
        )
      ) : (
        <ShiftTimeline
          event={event}
          rowAssignments={rowAssignments}
          roleCatalog={roleCatalog}
          flagsFor={flagsFor}
          onResize={onResize}
          onResizeCommit={onResizeCommit}
          onToggleRole={onToggleRole}
          onRemove={onRemove}
          overAllShifts={overAllShifts}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
export default function AssignmentsPage() {
  const params = useParams()
  const tournamentId = Number(params.id)
  const { show } = useToast()

  const { user: currentUser } = useAuth()
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership()
  const { selectedTournament } = useTournament()
  const {
    canManageMembers, isArchived, canTouchRole, canEditMember,
  } = useMemberRoleLock()

  const isAdmin = currentUser?.role === 'admin'
  const isOwner = !!membership?.is_owner
  const canManageEvents = isAdmin || isOwner || hasPermission('manage_events')
  // Matches the backend's read gate on GET .../assignments/ (manage_events OR
  // manage_members — staffing is part of reading the event, deciding it is
  // member data). Writes need manage_members specifically; see canManageMembers
  // below, checked at each mutation.
  const canView = canManageEvents || canManageMembers

  const [events, setEvents] = useState<TournamentEvent[] | null>(null)
  const [rows, setRows] = useState<Assignment[]>([])
  const [members, setMembers] = useState<MembershipFull[]>([])
  const [allShifts, setAllShifts] = useState<TournamentShift[]>([])
  const [roleCatalog, setRoleCatalog] = useState<Role[]>([])
  const [tracks, setTracks] = useState<TournamentTrack[]>([])
  const [loadError, setLoadError] = useState<string | undefined>()

  const [focusedId, setFocusedId] = useState<number | null>(null)

  const [eventQuery, setEventQuery] = useState('')
  const [eventFilters, setEventFilters] = useState<EventsFilterState>(emptyFilterState(EVENTS_FILTER_KEYS))
  const [eventDisplay, setEventDisplay] = useState<EventDisplayState>(DEFAULT_EVENT_DISPLAY)
  const [showEventFilterModal, setShowEventFilterModal] = useState(false)
  const [showEventDisplayModal, setShowEventDisplayModal] = useState(false)

  const [memberQuery, setMemberQuery] = useState('')
  const [memberFilters, setMemberFilters] = useState<MembersFilterState>(emptyMembersFilter())
  const [memberDisplay, setMemberDisplay] = useState<MemberDisplayState>(DEFAULT_MEMBER_DISPLAY)
  const [showMemberFilterModal, setShowMemberFilterModal] = useState(false)
  const [showMemberDisplayModal, setShowMemberDisplayModal] = useState(false)

  // This viewer's saved view of the board — the event rows' filters and
  // metadata under one surface, the belt's under another. Read once: unlike
  // the roster's, nothing here gates a fetch (both halves filter client-side),
  // so the board renders on its defaults and settles onto the saved view when
  // this lands, rather than holding the page on a request.
  useEffect(() => {
    if (!canView) return
    let current = true
    displayConfigApi.get(tournamentId)
      .then((config) => {
        if (!current) return
        const events = config[ASSIGNMENTS_EVENTS]
        setEventFilters(eventsFilterFromStored(events?.filters))
        setEventDisplay(eventDisplayFromColumns(events?.columns))
        const card = config[ASSIGNMENT_CARD]
        setMemberFilters(membersFilterFromStored(card?.filters))
        setMemberDisplay(memberDisplayFromHidden(card?.hidden))
      })
      // No saved view (or no permission to read one) is not an error — the
      // board's defaults are a perfectly good board.
      .catch(() => {})
    return () => { current = false }
  }, [tournamentId, canView])

  const applyEventFilters = useCallback((next: EventsFilterState) => {
    setEventFilters(next)
    persistDisplayConfigSurface(tournamentId, ASSIGNMENTS_EVENTS, {
      filters: eventsFilterToStored(next),
    })
  }, [tournamentId])

  const applyEventDisplay = useCallback((next: EventDisplayState) => {
    setEventDisplay(next)
    persistDisplayConfigSurface(tournamentId, ASSIGNMENTS_EVENTS, {
      columns: eventDisplayToColumns(next),
    })
  }, [tournamentId])

  const applyMemberFilters = useCallback((next: MembersFilterState) => {
    setMemberFilters(next)
    persistDisplayConfigSurface(tournamentId, ASSIGNMENT_CARD, {
      filters: membersFilterToStored(next),
    })
  }, [tournamentId])

  const applyMemberDisplay = useCallback((next: MemberDisplayState) => {
    setMemberDisplay(next)
    persistDisplayConfigSurface(tournamentId, ASSIGNMENT_CARD, {
      hidden: memberDisplayToHidden(next),
    })
  }, [tournamentId])

  // Every id a not-yet-synced row gets — negative, so "real" (server-known)
  // vs. "still local" is just `id > 0` anywhere a handler needs to tell them
  // apart, with no second bookkeeping structure to keep in step.
  const localIdRef = useRef(0)
  function nextLocalId(): number {
    localIdRef.current -= 1
    return localIdRef.current
  }

  // Read by handlers that need the *latest* rows from outside React's render
  // cycle — a resize gesture's pointerup fires from a native listener set up
  // once at pointerdown, so the `rows` it would otherwise close over is
  // whatever they were at gesture start, not at release.
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])

  useEffect(() => {
    if (!canView) return
    let current = true
    tournamentEventsApi.list(tournamentId)
      .then((data) => { if (current) setEvents(data.map(withOrderedShifts)) })
      .catch((err: unknown) => {
        if (current) setLoadError(err instanceof ApiError ? err.message : 'Failed to load events.')
      })
    assignmentsApi.list(tournamentId).then((data) => { if (current) setRows(data) }).catch(() => {})
    tournamentShiftsApi.list(tournamentId).then((data) => { if (current) setAllShifts(data) }).catch(() => {})
    rolesApi.list(tournamentId).then((data) => { if (current) setRoleCatalog(data) }).catch(() => {})
    tournamentTracksApi.list(tournamentId).then((data) => { if (current) setTracks(data) }).catch(() => {})
    // manage_members-gated — a coordinator with only manage_events can view
    // the board (assignments read is manage_events OR manage_members) but
    // not the roster, so the belt just degrades to empty for them rather
    // than the page 403ing outright.
    membersApi.list(tournamentId).then((data) => { if (current) setMembers(data) }).catch(() => {})
    return () => { current = false }
  }, [tournamentId, canView])

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const byEvent = useMemo(() => assignmentsByEvent(rows), [rows])

  const eventFilterActive = isEventsFilterActive(eventFilters)
  const memberFilterActive = isMembersFilterActive(memberFilters)

  // Full objects, not shifts derived from them — a cosmetic track (Test
  // Writing) has no shifts of its own but still belongs on an event and still
  // carries a default role. See TournamentEvent.tracks.
  const eventTrackIds = useMemo(
    () => new Map((events ?? []).map((e) => [e.id, e.tracks.map((t) => t.id)])),
    [events],
  )

  const divisionOptions = useMemo(() => {
    const options = [...new Set((events ?? []).map((e) => e.division))]
      .filter((d) => d !== null)
      .map((d) => ({ value: d, label: `Division ${d}` }))
    // Offered only when something actually has no division — otherwise it is
    // a row that can only ever match nothing.
    return (events ?? []).some((e) => e.division === null)
      ? [...options, { value: EVENT_FILTER_UNSET, label: 'No division' }]
      : options
  }, [events])
  const trackOptions = useMemo(
    () => tracks.map((t) => ({ value: String(t.id), label: t.name })),
    [tracks],
  )
  const categoryOptions = useMemo(() => eventCategoryOptions(events ?? []), [events])

  const visibleEvents = useMemo(() => {
    const text = eventQuery.trim().toLowerCase()
    return (events ?? []).filter((event) => {
      if (text && !(event.name ?? '').toLowerCase().includes(text)) return false
      if (!filterAllows(eventFilters.division, event.division ?? EVENT_FILTER_UNSET)) return false
      if (!filterAllows(eventFilters.type, event.event_type)) return false
      if (!filterAllows(eventFilters.category, eventCategoryKey(event))) return false
      // Multi-valued, so filterAllows doesn't fit: an event passes when *any*
      // of its tracks is picked — filtering to Day 1 shouldn't hide an event
      // that runs on both Day 1 and Day 2.
      if (eventFilters.track.size > 0) {
        const ids = (eventTrackIds.get(event.id) ?? []).map(String)
        if (!ids.some((id) => eventFilters.track.has(id))) return false
      }
      const staffed = (byEvent.get(event.id)?.length ?? 0) > 0
      if (!filterAllows(eventFilters.staffing, staffed ? 'staffed' : 'unstaffed')) return false
      return true
    })
  }, [events, byEvent, eventFilters, eventQuery, eventTrackIds])

  const assignedIds = useMemo(() => new Set(rows.map((r) => r.member.membership_id)), [rows])

  const belt = useMemo(() => {
    const text = memberQuery.trim().toLowerCase()
    // The roster's paired filters are "{group}:{option}" strings, with
    // "__any__" on the right meaning "that group, unnarrowed" — see
    // MembersFilterModal.
    const trackPairs = [...memberFilters.track].map((v) => v.split(':'))
    const shiftPairs = [...memberFilters.shift].map((v) => v.split(':'))
    const lunchPairs = [...memberFilters.lunch].map((v) => v.split(':'))
    const competition = [...memberFilters.competition_event]
    const volunteer = [...memberFilters.volunteer_event]
    const ages = [...memberFilters.age]
    const assigned = [...memberFilters.assigned]

    return members.filter((member) => {
      // Unassigned-only used to be hard-wired here. It is a filter now, so the
      // panel can also answer "who is on this tournament at all" — and an
      // empty filter means both, the same as every other section.
      if (assigned.length === 1) {
        const isAssigned = assignedIds.has(member.id)
        if (assigned[0] === 'assigned' ? !isAssigned : isAssigned) return false
      }
      if (text && !fullName(member.user ?? { first_name: null, last_name: null })
        .toLowerCase().includes(text)) return false

      if (trackPairs.length) {
        const statuses = member.track_statuses ?? []
        const ok = trackPairs.some(([trackId, status]) =>
          statuses.some((s) =>
            String(s.track_id) === trackId && (status === '__any__' || s.status === status)))
        if (!ok) return false
      }

      if (shiftPairs.length) {
        const available = member.availability ?? []
        const ok = shiftPairs.some(([trackId, shiftId]) =>
          available.some((a) => shiftId === '__any__'
            ? String(a.track_id) === trackId
            : String(a.shift_id) === shiftId))
        if (!ok) return false
      }

      if (lunchPairs.length) {
        // The group half is itself "{trackId}:{category}", so a lunch value
        // arrives as three segments and the answer is everything after them.
        const lunch = member.lunch ?? []
        const ok = lunchPairs.some((parts) => {
          const [trackId, category, answer] = parts
          return lunch.some((l) =>
            String(l.track_id) === trackId && l.category === category
            && (answer === '__any__' || l.value === answer))
        })
        if (!ok) return false
      }

      if (competition.length) {
        const ids = (member.user?.competition_experience ?? []).map((e) => String(e.event.id))
        if (!competition.some((id) => ids.includes(id))) return false
      }

      if (volunteer.length) {
        const ids = (member.user?.volunteer_experience ?? [])
          .map((e) => (e.event ? String(e.event.id) : null))
          .filter((id): id is string => id !== null)
        if (!volunteer.some((id) => ids.includes(id))) return false
      }

      if (ages.length) {
        // Absent is unknown, not false — a member with no flag must not read
        // as under 18.
        const ok = ages.some((flag) =>
          flag === 'over_18' ? member.is_over_18 === true : member.is_over_21 === true)
        if (!ok) return false
      }

      return true
    })
  }, [assignedIds, members, memberFilters, memberQuery])

  const flagsFor = useMemo(() => {
    const perMember = new Map<number, Assignment[]>()
    for (const row of rows) {
      const key = row.member.membership_id
      if (key === null) continue
      const list = perMember.get(key)
      if (list) list.push(row)
      else perMember.set(key, [row])
    }
    return (assignment: Assignment): Flag[] => {
      const id = assignment.member.membership_id
      const member = id === null ? undefined : memberById.get(id)
      if (!member) return []
      return assignmentFlags(
        assignment,
        memberFacts(member, perMember.get(member.id) ?? []),
        { eventTrackIds },
      )
    }
  }, [memberById, rows, eventTrackIds])

  // ---------------------------------------------------------------------
  // Server sync — every write lands here or in the two per-gesture callers
  // below. Local state moves first; the API call follows and reconciles
  // (a create swaps the temp row for the server's, a failed write rolls
  // its local change back and toasts).
  // ---------------------------------------------------------------------

  /** Every mutating handler's first line. Matches the backend's write gate
   *  on the assignments routes (manage_members) — narrower than canView,
   *  which also admits manage_events alone for reading the board. */
  function requireWriteAccess(): boolean {
    if (canManageMembers) return true
    show("You need the manage members permission to edit assignments.", 'error')
    return false
  }

  async function createAssignmentRow(row: Assignment) {
    try {
      const created = await assignmentsApi.create(tournamentId, {
        tournament_event_id: row.event.id,
        membership_id: row.member.membership_id!,
        role_id: row.role.id!,
        tournament_shift_id: row.shift?.id ?? null,
      })
      setRows((current) => current.map((r) => (r.id === row.id ? created : r)))
    } catch (err) {
      setRows((current) => current.filter((r) => r.id !== row.id))
      show(err instanceof ApiError ? err.message : 'Failed to assign — the change was rolled back.', 'error')
    }
  }

  async function deleteAssignmentRow(row: Assignment) {
    // A row that never reached the server (its create is still in flight, or
    // failed and was already rolled back) has nothing there to remove.
    if (row.id < 0) return
    try {
      await assignmentsApi.delete(tournamentId, row.id)
    } catch (err) {
      setRows((current) => [...current, row])
      show(err instanceof ApiError ? err.message : 'Failed to remove — restored.', 'error')
    }
  }

  /** The role a track hands a member placed on it with nothing picked yet —
   *  see TournamentTrack.default_role_id. `trackId` names the track a drop
   *  aimed at; without one the event's first track answers, which is only
   *  ever right when there is nothing to disambiguate. A track with no
   *  default configured, or an event with no track at all, has nothing to
   *  fall back to. */
  /** The track a drop bills its default role to. A cosmetic column names one;
   *  a shift or all-shifts drop takes the track its shifts fall on, since a
   *  shift belongs to exactly one primary track. Only the bare row target,
   *  which by then has neither, falls back to the event's first track. */
  function trackForDropId(
    kind: string, target: Record<string, unknown>,
    event: TournamentEvent, shiftIds: (number | null)[],
  ): number | undefined {
    if (kind === 'track') return target.trackId as number
    const shiftId = shiftIds.find((id): id is number => id !== null)
    return event.shifts.find((s) => s.id === shiftId)?.track_id
  }

  function trackForDrop(event: TournamentEvent, trackId?: number): TournamentTrack | undefined {
    return trackId === undefined
      ? event.tracks[0]
      : event.tracks.find((t) => t.id === trackId)
  }

  function defaultRoleFor(event: TournamentEvent, trackId?: number): Role | null {
    const roleId = trackForDrop(event, trackId)?.default_role_id ?? null
    if (roleId === null) return null
    return roleCatalog.find((r) => r.id === roleId) ?? null
  }

  /**
   * Rewrite one lane as exactly `shiftIds × roles`.
   *
   * A lane is a grid: one assignment row per shift per role. Resizing changes
   * the shift axis, the role pill changes the role axis, and both are the same
   * write — so both land here rather than each hand-rolling its own add/drop
   * pass. Rows for a (shift, role) pair that already exists are reused by
   * identity, so an edit only churns the cells that actually changed — and
   * `added`/`removed` name exactly those cells, for the caller to sync.
   */
  function rebuildLane(
    current: Assignment[],
    eventId: number,
    laneKey: string,
    shiftIds: (number | null)[],
    roles: AssignmentRole[],
    event: TournamentEvent,
  ): { rows: Assignment[]; added: Assignment[]; removed: Assignment[] } {
    const inLane = current.filter((row) =>
      row.event.id === eventId && laneKeyOf(row) === laneKey)
    if (inLane.length === 0 || roles.length === 0) return { rows: current, added: [], removed: [] }

    const laneIds = new Set(inLane.map((row) => row.id))
    const cellKey = (shiftId: number | null, role: AssignmentRole) =>
      `${shiftId ?? 'none'}|${roleKey(role)}`
    const existing = new Map(inLane.map((row) => [cellKey(row.shift?.id ?? null, row.role), row]))

    const next: Assignment[] = []
    for (const shiftId of shiftIds) {
      for (const role of roles) {
        const found = existing.get(cellKey(shiftId, role))
        next.push(found ?? {
          ...inLane[0],
          id: nextLocalId(),
          role,
          shift: shiftId === null ? null : event.shifts.find((s) => s.id === shiftId) ?? null,
          updated_at: new Date().toISOString(),
        })
      }
    }

    // Same cells as before — hand back the identical array so React can skip
    // the render. A resize commits on every pointer move, so this is the
    // common case, not the rare one.
    if (next.length === inLane.length && next.every((row) => laneIds.has(row.id))) {
      return { rows: current, added: [], removed: [] }
    }
    const nextIds = new Set(next.map((row) => row.id))
    return {
      rows: [...current.filter((row) => !laneIds.has(row.id)), ...next],
      added: next.filter((row) => !laneIds.has(row.id)),
      removed: inLane.filter((row) => !nextIds.has(row.id)),
    }
  }

  /** The lane's distinct shifts in the event's own order. `[null]` keeps an
   *  unpinned lane unpinned rather than silently pinning it to shift one. */
  function laneShiftIds(inLane: Assignment[], event: TournamentEvent): (number | null)[] {
    const have = new Set(inLane.map((row) => row.shift?.id ?? null))
    const ordered = event.shifts.filter((s) => have.has(s.id)).map((s) => s.id)
    return ordered.length > 0 ? ordered : [null]
  }

  /**
   * Resize a bar so it reaches `index`.
   *
   * Reads the lane out of current rows by key rather than taking a captured
   * Lane: a resize commits on every pointer move, so anything captured at
   * pointerdown is stale by the second frame — the rows it names have already
   * been replaced. That staleness is why the bar used to stop tracking the
   * cursor after one step. Purely local — see onResizeCommit for the sync,
   * which fires once, on release, rather than once per pixel.
   */
  function handleResize(laneKey: string, eventId: number, edge: 'start' | 'end', index: number) {
    if (!canManageMembers) return
    const event = (events ?? []).find((e) => e.id === eventId)
    if (!event) return

    setRows((current) => {
      const inLane = current.filter((row) =>
        row.event.id === eventId && laneKeyOf(row) === laneKey)
      if (inLane.length === 0) return current

      const shiftIds = event.shifts.map((s) => s.id)
      const covered = inLane
        .map((row) => (row.shift ? shiftIds.indexOf(row.shift.id) : -1))
        .filter((i) => i >= 0)
      if (covered.length === 0) return current

      const first = Math.min(...covered)
      const last = Math.max(...covered)
      // The dragged edge moves; the other one anchors.
      const from = edge === 'start' ? Math.min(index, last) : first
      const to = edge === 'start' ? last : Math.max(index, first)

      return rebuildLane(
        current, eventId, laneKey,
        event.shifts.slice(from, to + 1).map((s) => s.id),
        rolesOf(inLane), event,
      ).rows
    })
  }

  /** Syncs a resize gesture's net effect once it ends — the whole-lane diff
   *  between `beforeRows` (pointerdown) and rowsRef (release), rather than a
   *  write per pointermove. Cells that were added then removed again within
   *  the same gesture cancel out here for free — neither ever reaches this
   *  as a diff, since only the endpoints are compared. */
  function handleResizeCommit(laneKey: string, eventId: number, beforeRows: Assignment[]) {
    const beforeIds = new Set(beforeRows.map((r) => r.id))
    const current = rowsRef.current.filter((row) =>
      row.event.id === eventId && laneKeyOf(row) === laneKey)
    const currentIds = new Set(current.map((r) => r.id))
    for (const row of current.filter((r) => !beforeIds.has(r.id))) createAssignmentRow(row)
    for (const row of beforeRows.filter((r) => !currentIds.has(r.id))) deleteAssignmentRow(row)
  }

  /** Drop a whole bar: every row for that member on that event, across every
   *  shift and role. Removing one row would leave a torn span or a stray role
   *  behind, which is not what an × on the chip promises. */
  function handleRemove(laneKey: string, eventId: number) {
    if (!requireWriteAccess()) return
    const toRemove = rows.filter((row) => row.event.id === eventId && laneKeyOf(row) === laneKey)
    setRows((current) => current.filter((row) =>
      !(row.event.id === eventId && laneKeyOf(row) === laneKey)))
    for (const row of toRemove) deleteAssignmentRow(row)
  }

  /** Add or drop one role across every shift the bar covers. Roles belong to
   *  the bar, not to a single column — a runner for the first half and a
   *  scorer for the second is two bars, which is what dragging one out gives
   *  you. A single discrete action, unlike resize, so it syncs immediately. */
  function handleToggleRole(laneKey: string, eventId: number, role: AssignmentRole) {
    if (!requireWriteAccess()) return
    const event = (events ?? []).find((e) => e.id === eventId)
    if (!event) return

    const inLane = rows.filter((row) => row.event.id === eventId && laneKeyOf(row) === laneKey)
    if (inLane.length === 0) return

    const currentRoles = rolesOf(inLane)
    const nextRoles = currentRoles.some((r) => sameRole(r, role))
      ? currentRoles.filter((r) => !sameRole(r, role))
      : [...currentRoles, role].sort((a, b) => a.label.localeCompare(b.label))
    // The picker locks the last role, but a stale click could still land.
    if (nextRoles.length === 0) return

    const { rows: nextRows, added, removed } = rebuildLane(
      rows, eventId, laneKey, laneShiftIds(inLane, event), nextRoles, event,
    )
    setRows(nextRows)
    for (const row of added) createAssignmentRow(row)
    for (const row of removed) deleteAssignmentRow(row)
  }

  const { setPanel, clearPanel } = useSetLayoutPanel()
  const focused = focusedId === null ? null : memberById.get(focusedId) ?? null

  // Both panels live in the shell's single slot as one flex row, since the
  // slot holds one registration at a time. Widths add up so the board gives
  // back exactly what the open panels take.
  useEffect(() => {
    const index = focused ? belt.findIndex((m) => m.id === focused.id) : -1

    setPanel(
      <div style={{ display: 'flex', height: '100%' }}>
        {/* No onClose: the belt is the only way onto the board, so a control
            that hides it would leave the page unable to do its one job. */}
        <DockedPanel
          width={BELT_PANEL_WIDTH}
          headerActions={
            <>
              <Button
                type="button" variant="secondary" size="sm" iconOnly
                title="Configure member cards"
                onClick={() => setShowMemberDisplayModal(true)}
              >
                <IconEye size={14} />
              </Button>
              <Button
                type="button" variant={memberFilterActive ? 'primary' : 'secondary'}
                size="sm" iconOnly title="Filter members"
                onClick={() => setShowMemberFilterModal(true)}
              >
                <IconFilter size={14} />
              </Button>
            </>
          }
        >
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* secondary = white. primary is the same light grey as the page
                background, which would make the field disappear into it. */}
            <Input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              onClear={() => setMemberQuery('')}
              placeholder="Search members"
              icon={<IconSearch />}
              size="md"
              variant="secondary"
              font="sans"
              fullWidth
            />

            {belt.length === 0 ? (
              <EmptyState
                icon={<IconUser size={24} />}
                title={memberQuery || memberFilterActive ? 'No members match' : 'No members yet'}
                description={memberQuery || memberFilterActive ? 'Try a wider filter.' : undefined}
                action={
                  memberQuery || memberFilterActive ? (
                    <Button
                      size="sm" variant="secondary"
                      onClick={() => { setMemberQuery(''); applyMemberFilters(emptyMembersFilter()) }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              belt.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  selected={focusedId === member.id}
                  display={memberDisplay}
                  allShifts={allShifts}
                  onOpen={() => setFocusedId(member.id)}
                />
              ))
            )}
          </div>
        </DockedPanel>

        {focused && (
          <MemberPanel
            key={focused.id}
            tournamentId={tournamentId}
            membershipId={focused.id}
            allRoles={roleCatalog}
            canTouchRole={canTouchRole}
            canEditMember={canEditMember}
            collectIsOver18={!!selectedTournament?.collect_is_over_18}
            collectIsOver21={!!selectedTournament?.collect_is_over_21}
            isArchived={isArchived}
            isSelf={currentUser?.id === focused.user.id}
            // No onRemove/onSelfRemove: removing someone from the tournament
            // is the roster's job, not this board's — omitting them hides
            // the control entirely rather than wiring a flow that doesn't
            // belong here.
            onClose={() => setFocusedId(null)}
            onUpdated={(updated) => setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))}
            onPrev={() => index > 0 && setFocusedId(belt[index - 1].id)}
            onNext={() => index < belt.length - 1 && setFocusedId(belt[index + 1].id)}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < belt.length - 1}
          />
        )}
      </div>,
      BELT_PANEL_WIDTH + (focused ? MEMBER_PANEL_WIDTH : 0),
    )
  }, [
    focused, focusedId, belt, allShifts, memberQuery, memberFilters,
    memberFilterActive, memberDisplay, applyMemberFilters, setPanel, clearPanel,
  ])

  // Unmount only — leaving the page must not leave the panels behind.
  useEffect(() => () => clearPanel(), [clearPanel])
  /**
   * Which shifts a drop lands on.
   *
   *   shift    that one column
   *   allday   every shift the event has
   *   track    one cosmetic track's column — no shift, and its default role
   *   event    the row itself, for an event with neither of the above
   *
   * Returns null shifts as [null] rather than [] so the caller always writes
   * exactly one row per entry — an empty list would silently assign nobody.
   */
  function targetShiftIds(target: Record<string, unknown>, event: TournamentEvent) {
    if (target.kind === 'shift') return [target.shiftId as number]
    if (target.kind === 'allday') {
      return event.shifts.length > 0 ? event.shifts.map((s) => s.id) : [null]
    }
    return [null]
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    const target = over.data.current
    if (!target) return
    const kind = target.kind as string
    if (kind !== 'shift' && kind !== 'allday' && kind !== 'event' && kind !== 'track') return
    if (!requireWriteAccess()) return

    const eventId = target.eventId as number
    const event = (events ?? []).find((e) => e.id === eventId)
    if (!event) return
    const shiftIds = targetShiftIds(target, event)
    const source = active.data.current

    const eventRef = {
      id: event.id, name: event.name, division: event.division,
      event_type: event.event_type, shifts: event.shifts,
    }
    const shiftFor = (id: number | null) =>
      id === null ? null : event.shifts.find((s) => s.id === id) ?? null

    if (source?.kind === 'chip') {
      const assignment = source.assignment as Assignment
      // Move the whole bar, not the one row under the cursor: a bar is a
      // grid of rows sharing a membership, and moving one of them would tear
      // the span — or drop every role but one. A cross-event move has no
      // single PATCH for it (the shift, not the event, is what a write can
      // repoint), so it's a delete of the old rows and a create of the new.
      const laneKey = laneKeyOf(assignment)
      const moving = rows.filter((row) =>
        row.event.id === assignment.event.id && laneKeyOf(row) === laneKey)
      const movingIds = new Set(moving.map((r) => r.id))
      const template = moving[0] ?? assignment
      const rolesToKeep = rolesOf(moving.length > 0 ? moving : [assignment])
      const newRows: Assignment[] = shiftIds.flatMap((shiftId) => rolesToKeep.map((role) => ({
        ...template,
        id: nextLocalId(),
        event: eventRef,
        role,
        shift: shiftFor(shiftId),
        updated_at: new Date().toISOString(),
      })))
      setRows((current) => [...current.filter((row) => !movingIds.has(row.id)), ...newRows])
      for (const row of moving) deleteAssignmentRow(row)
      for (const row of newRows) createAssignmentRow(row)
      return
    }

    if (source?.kind === 'member') {
      const member = memberById.get(source.membershipId as number)
      if (!member) return

      // Which track's default role this drop grants. A cosmetic column says
      // so outright; a shift knows the day it falls on, so a timeline drop
      // answers from the shift rather than from whichever track happened to
      // be listed first on the event.
      const role = defaultRoleFor(event, trackForDropId(kind, target, event, shiftIds))
      if (!role) {
        const track = trackForDrop(event, trackForDropId(kind, target, event, shiftIds))
        show(
          !track
            ? 'This event has no track to look up a default role from.'
            : `No default role set for ${track.name} — set one in tournament settings before assigning from the board.`,
          'error',
        )
        return
      }

      const newRows: Assignment[] = shiftIds.map((shiftId) => ({
        id: nextLocalId(),
        event: eventRef,
        member: {
          user_id: member.user!.id,
          membership_id: member.id,
          first_name: member.user!.first_name,
          last_name: member.user!.last_name,
        },
        role,
        shift: shiftFor(shiftId),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      setRows((current) => [...current, ...newRows])
      for (const row of newRows) createAssignmentRow(row)
      // The card leaves the belt on assignment, so a detail panel still
      // pointing at it would be orphaned.
      if (focusedId === member.id) setFocusedId(null)
    }
  }

  function labelFor(activeId: string) {
    if (activeId.startsWith('member:')) {
      const member = memberById.get(Number(activeId.slice(7)))
      return member ? fullName(member.user ?? { first_name: null, last_name: null }) : null
    }
    const assignment = rows.find((r) => `chip:${r.id}` === activeId)
    return assignment ? fullName(assignment.member) : null
  }

  // The DndContext lives in the layout — the belt is rendered into the panel
  // slot, which is outside <main>, so a context inside this page could never
  // reach it. Behaviour still belongs here; only the context moved.
  useRegisterBoardDnd({
    onDragEnd: handleDragEnd,
    renderOverlay: (activeId) => {
      const label = labelFor(activeId)
      if (!label) return null
      return (
        <div style={{
          padding: '6px 10px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          {label}
        </div>
      )
    },
  })

  if (membershipLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spinner size="lg" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div>
        <PageHeader heading="Assignments" />
        <Card radius="lg" style={{ padding: '8px' }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage events or manage members permission to view this page."
          />
        </Card>
      </div>
    )
  }

  if (events === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    // No padding or max-width of its own: the shell's <main> already supplies
    // 22px/24px, and a centred max-width fought the docked panels for space.
    <div>
      <PageHeader
        heading="Assignments"
      />

      {loadError && (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)', marginBottom: '10px' }}>
          {loadError}
        </p>
      )}

      {/* Events own the page and its scroll — no inner scroller. */}
      <div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Input
              value={eventQuery}
              onChange={(e) => setEventQuery(e.target.value)}
              onClear={() => setEventQuery('')}
              placeholder="Search events"
              icon={<IconSearch />}
              size="md"
              variant="secondary"
              font="sans"
              fullWidth
            />
            <Button
              size="md"
              variant={eventFilterActive ? 'primary' : 'secondary'}
              onClick={() => setShowEventFilterModal(true)}
            >
              <IconFilter size={14} /> Filter
            </Button>
            <Button size="md" variant="secondary" onClick={() => setShowEventDisplayModal(true)}>
              <IconEye size={14} /> Display
            </Button>
          </div>

          {visibleEvents.length === 0 ? (
            <EmptyState
              icon={<IconEvents size={24} />}
              title="No events match"
              description="Try a wider search or filter."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setEventQuery(''); applyEventFilters(emptyFilterState(EVENTS_FILTER_KEYS)) }}
                >
                  Clear
                </Button>
              }
            />
          ) : (
            visibleEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                rowAssignments={byEvent.get(event.id) ?? []}
                roleCatalog={roleCatalog}
                flagsFor={flagsFor}
                display={eventDisplay}
                onResize={handleResize}
                onResizeCommit={handleResizeCommit}
                onToggleRole={handleToggleRole}
                onRemove={handleRemove}
              />
            ))
          )}
        </div>

      </div>

      {showEventFilterModal && (
        <EventsFilterModal
          divisionOptions={divisionOptions}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={categoryOptions}
          trackOptions={trackOptions}
          showStaffing
          filters={eventFilters}
          onApply={applyEventFilters}
          onClose={() => setShowEventFilterModal(false)}
        />
      )}
      {showEventDisplayModal && (
        <EventDisplayModal
          display={eventDisplay}
          onApply={applyEventDisplay}
          onClose={() => setShowEventDisplayModal(false)}
        />
      )}
      {/* No `options` — the roster's own modal fetches the real tournament's
          filter options itself when it isn't handed pre-built ones. */}
      {showMemberFilterModal && (
        <MembersFilterModal
          tournamentId={tournamentId}
          roleOptions={roleCatalog.map((r) => ({ value: String(r.id), label: r.label }))}
          filters={memberFilters}
          onApply={applyMemberFilters}
          onClose={() => setShowMemberFilterModal(false)}
        />
      )}
      {showMemberDisplayModal && (
        <MemberDisplayModal
          display={memberDisplay}
          tracks={tracks.map((t) => ({ id: t.id, label: t.name }))}
          onApply={applyMemberDisplay}
          onClose={() => setShowMemberDisplayModal(false)}
        />
      )}
    </div>
  )
}
