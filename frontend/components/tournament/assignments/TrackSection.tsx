"use client";

import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'

import { MemberChip } from '@/components/tournament/assignments/MemberChip'
import { TrackShiftGrid } from '@/components/tournament/assignments/TrackShiftGrid'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconClock, IconLocation } from '@/components/ui/Icons'
import { PillMenu } from '@/components/ui/PillMenu'
import { ProgressRing } from '@/components/ui/ProgressRing'
import type {
  Assignment, EventStaffingNeedRead, Role, TournamentEvent, TournamentShift, TournamentTrack,
} from '@/lib/api'
import type { Flag } from '@/lib/assignments/flags'
import type { Lane } from '@/lib/assignments/lanes'
import type { BoardHandlers } from '@/lib/assignments/board'
import { formatTime } from '@/lib/timeFormat'

import type { EventDisplayState } from '@/components/tournament/assignments/EventDisplayModal'

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

/** How many distinct members hold one role on one track — never a row count.
 *  A member spanning morning and afternoon shifts on the same track is two
 *  assignment rows (one per shift) but one person, so counting rows would
 *  make splitting a shift in two look like hiring somebody new. */
function staffedCount(rowAssignments: readonly Assignment[], roleId: number, trackId: number): number {
  const members = new Set<number | null>()
  for (const a of rowAssignments) {
    if (a.role.id === roleId && a.track.id === trackId) members.add(a.member.membership_id)
  }
  return members.size
}

/** One role's progress toward one track's need for it. Full role name and a
 *  plain `#/#`, not an abbreviation — the crowding that motivated an
 *  abbreviated line only happens once several tracks' roles share one line,
 *  and this always renders inside its own track's block. Same three-state
 *  colour as the chip warning border: success once filled, warning while
 *  short, muted at zero. */
function StaffingNeedLine({ need, filled }: { need: EventStaffingNeedRead; filled: number }) {
  const color = filled >= need.count
    ? 'var(--color-success)'
    : filled > 0
      ? 'var(--color-warning)'
      : 'var(--color-border-strong)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <ProgressRing completed={filled} total={need.count} size={13} strokeWidth={16} color={color} />
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
        {need.role_label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        {filled}/{need.count}
      </span>
    </div>
  )
}

/** A track's default role, as a pill menu — picking a new role hands the
 *  change to the caller rather than writing anything itself, since applying
 *  it means both a track PATCH and a bulk assignment rewrite that only the
 *  page has the state for. Shared by the timeline header and a cosmetic
 *  track's column header — same field, same control, wherever it shows. */
function DefaultRolePillMenu({ track, roleCatalog, onPickDefaultRole }: {
  track: TournamentTrack
  roleCatalog: Role[]
  onPickDefaultRole: (track: TournamentTrack, role: Role) => Promise<void>
}) {
  const role = track.default_role_id === null
    ? null
    : roleCatalog.find((r) => r.id === track.default_role_id) ?? null
  return (
    <PillMenu
      label={role ? role.label : 'No default role'}
      tone={role ? 'default' : 'muted'}
      items={roleCatalog}
      getKey={(r) => r.id}
      renderLabel={(r) => r.label}
      isSelected={(r) => role !== null && role.id === r.id}
      onSelect={(r) => onPickDefaultRole(track, r)}
      width={180}
      align="left"
    />
  )
}

/**
 * Everything one track of an event holds: its logistics, its staffing target,
 * and its people.
 *
 * The section is the unit the whole row is built from, because a track is the
 * scope of every answer an event gives — where it is, when it runs, how many
 * of each role it wants, who is on it. Splitting those across an event-wide
 * metadata column and a separate people area meant an event on two days had
 * to either join two answers into one line or pick one and drop the other.
 *
 * A track with shifts draws its timeline; a shiftless one (Test Writing, or
 * a day whose shifts were detached) is a dashed box that takes drops whole,
 * since it has no columns to aim at.
 */
export function TrackSection({
  event, track, shifts, pinnedLanes, unpinnedLanes, rowAssignments, roleCatalog, flagsFor,
  display, showLabel, overAllShifts,
  handlers,
}: {
  event: TournamentEvent
  track: TournamentTrack
  /** This track's own shifts, in schedule order. Empty for a shiftless one. */
  shifts: TournamentShift[]
  /** Bars on those shifts. */
  pinnedLanes: Lane[]
  /** People on this track but on none of its shifts. */
  unpinnedLanes: Lane[]
  rowAssignments: Assignment[]
  roleCatalog: Role[]
  flagsFor: (a: Assignment) => Flag[]
  display: EventDisplayState
  /** False on a track tab and in simple mode — the tab already names the
   *  track, so the pill, time, location and staffing stand on their own. */
  showLabel: boolean
  overAllShifts: boolean
  handlers: BoardHandlers
}) {
  const hasShifts = shifts.length > 0
  // A track with columns is aimed at through them; a shiftless one is aimed
  // at whole, so only it registers as a target.
  const { setNodeRef, isOver } = useDroppable({
    id: `track:${event.id}:${track.id}`,
    data: { kind: 'track', eventId: event.id, trackId: track.id },
    disabled: hasShifts,
  })

  const detail = event.track_details.find((d) => d.track_id === track.id) ?? null
  // Building and room only. The floor is stored and edited per track, but a
  // room number already implies it to anyone reading the board, and spelling
  // it out made the commonest line on the row a third longer.
  const location = detail?.building_name
    ? [detail.building_name, detail.rooms.join(', ')].filter(Boolean).join(' ')
    : null
  // The track's window: its first shift's start to its last one's end.
  // Derived, not stored — an event has no times of its own, only the union of
  // the shifts on it (see TournamentEvent in models.py).
  const span = hasShifts
    ? `${formatTime(shifts[0].start)} – ${formatTime(shifts[shifts.length - 1].end)}`
    : null
  const needs = detail?.needs ?? []

  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0,
        // Boxed only where there is no timeline — a grid draws its own edges
        // in its columns. The box is also the drop target itself, so it tints
        // rather than lighting its border, the same signal the shift columns
        // give.
        ...(hasShifts ? null : {
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          background: isOver ? 'var(--color-accent-subtle)' : 'transparent',
          transition: 'background 120ms ease',
        }),
      }}
    >
      {/* Label, role, time and place on one line — they are all answers to
          "what is this track of this event", and each is short enough that
          stacking them spent a row of height per word. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
        {showLabel && (
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {track.name}
          </span>
        )}
        <DefaultRolePillMenu
          track={track}
          roleCatalog={roleCatalog}
          onPickDefaultRole={handlers.onPickDefaultRole}
        />
        {display.time && span && (
          <MetaLine icon={<IconClock size={12} />}>{span}</MetaLine>
        )}
        {display.room && location && (
          <MetaLine icon={<IconLocation size={12} />}>{location}</MetaLine>
        )}
      </div>

      {/* Across, not down: a track wants a handful of roles at most, and a
          row of them reads as one progress line for the track rather than as
          a list of separate facts. */}
      {needs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 14px' }}>
          {needs.map((need) => (
            <StaffingNeedLine
              key={need.role_id}
              need={need}
              filled={staffedCount(rowAssignments, need.role_id, track.id)}
            />
          ))}
        </div>
      )}

      {hasShifts ? (
        <>
          <TrackShiftGrid
            eventId={event.id}
            shifts={shifts}
            lanes={pinnedLanes}
            roleCatalog={roleCatalog}
            flagsFor={flagsFor}
            handlers={handlers}
            overAllShifts={overAllShifts}
          />
          {/* Detaching a shift unpins its people without dropping them (see
              detach_shifts_from_assignments), so a track with columns can
              still hold someone on none of them. Shown under its own grid
              rather than in a section of their own — they are this track's
              staffing either way. */}
          {unpinnedLanes.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px',
              paddingTop: '5px', borderTop: '1px dashed var(--color-border)',
            }}>
              <span style={{
                fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                color: 'var(--color-text-tertiary)',
              }}>
                No shift
              </span>
              {unpinnedLanes.map((lane) => (
                <MemberChip
                  key={lane.key}
                  lane={lane}
                  eventId={event.id}
                  roleCatalog={roleCatalog}
                  flagsFor={flagsFor}
                  handlers={handlers}
                />
              ))}
            </div>
          )}
        </>
      ) : unpinnedLanes.length === 0 ? (
        // Kept on screen rather than hidden: this box is the only way onto a
        // shiftless track, and a target that appears only once you have
        // already hit it is not a target you can find.
        <EmptyState size="sm" title="Nobody assigned" />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {unpinnedLanes.map((lane) => (
            <MemberChip
              key={lane.key}
              lane={lane}
              eventId={event.id}
              roleCatalog={roleCatalog}
              flagsFor={flagsFor}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </div>
  )
}
