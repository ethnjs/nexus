"use client";

import {
  memo, useMemo, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { useDraggable } from '@dnd-kit/core'

import { RolePillMenu } from '@/components/tournament/assignments/RolePillMenu'
import { IconWarning, IconX } from '@/components/ui/Icons'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Assignment, Role } from '@/lib/api'
import { fullName } from '@/lib/assignments/board'
import type { Flag } from '@/lib/assignments/flags'
import { laneFlags, type AssignmentRole, type Lane } from '@/lib/assignments/lanes'

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
// MemberChip — one assigned person. Name only.
// ---------------------------------------------------------------------------
interface MemberChipProps {
  /** The bar this chip draws — one person on the event, every role they hold
   *  here (a lane is one row per shift *per role*). */
  lane: Lane
  eventId: number
  /** Every role the tournament offers, for the pill's picker. */
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  /** Adds or removes one role, leaving the rest — the multi-select path. */
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  /** Replaces every role this person holds here with the one picked — the
   *  default path, since swapping a role is far commoner than stacking one. */
  onPickRole: (laneKey: string, eventId: number, role: AssignmentRole) => void
  /** Drops the whole bar — every shift, every role. */
  onRemove: (laneKey: string, eventId: number) => void
  /** Given, the chip grows its own resize edges — no separate handles. */
  onResizeStart?: (edge: 'start' | 'end', e: ReactPointerEvent) => void
  /** Which edge is mid-drag, so its grip stays lit once the cursor has
   *  outrun the chip. */
  resizingEdge?: 'start' | 'end' | null
}

/**
 * The draggable shell. useDraggable re-renders this on every drop-target
 * crossing, and context bypasses memo — so the shell stays thin and the real
 * chip lives in MemberChipBody, the same split MemberCard uses.
 */
export function MemberChip(props: MemberChipProps) {
  const [hovered, setHovered] = useState(false)
  const assignment = props.lane.assignments[0]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip:${assignment.id}`,
    data: { kind: 'chip', assignment },
  })
  const grab = useGrabCursor(listeners)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={grab.onPointerDown}
      style={{
        minWidth: 0,
        cursor: grab.pressed || isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        // dnd-kit makes a draggable focusable, so grabbing one paints the
        // browser's default focus ring — the black outline. Dragging already
        // has its own visual state; the ring only adds a hard edge.
        outline: 'none',
      }}
    >
      <MemberChipBody {...props} hovered={hovered} />
    </div>
  )
}

const MemberChipBody = memo(function MemberChipBody({
  lane, eventId, roleCatalog, flagsFor, onToggleRole, onPickRole, onRemove, onResizeStart, resizingEdge, hovered,
}: MemberChipProps & { hovered: boolean }) {
  const assignment = lane.assignments[0]
  const roles = lane.roles
  // Memoised so a hover toggle doesn't recompute every row's flags.
  const flags = useMemo(() => laneFlags(lane, flagsFor), [lane, flagsFor])

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
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: '6px',
        // Horizontal padding clears the 12px grips, so the name never sits
        // under a hit zone on a chip narrowed to a single shift.
        padding: '4px 14px', borderRadius: 'var(--radius-md)',
        border: `1px solid ${flags.length ? 'var(--color-warning)' : 'var(--color-border)'}`,
        background: flags.length ? 'var(--color-warning-subtle)' : 'var(--color-surface)',
        fontSize: '12px',
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
        <RolePillMenu
          roles={roles}
          roleCatalog={roleCatalog}
          onToggleRole={(role) => onToggleRole(lane.key, eventId, role)}
          onPickRole={(role) => onPickRole(lane.key, eventId, role)}
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
        onClick={() => onRemove(lane.key, eventId)}
        title="Remove from this event"
        label={`Remove ${fullName(assignment.member)} from this event`}
      >
        <IconX size={10} />
      </ChipAction>
      {onResizeStart && edge('end')}
    </div>
  )
})
