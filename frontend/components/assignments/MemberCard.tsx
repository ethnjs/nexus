'use client'

/**
 * One member's belt card, on the assignments board.
 *
 * A miniature of the member panel, and deliberately built out of the same
 * pieces: AgeFlagsBadges and AvailabilityTimeline are imported rather than
 * reimplemented, and the event-preference accordion follows
 * EventPreferencesSection's rules (single-event options render as the event
 * itself, multi-event options collapse behind a count). What differs is
 * scale — the panel is 700px and can afford PanelField's label/value grid;
 * the belt is ~316px of usable width, so sections are separated by a mono
 * caps rule instead and every value row is compressed.
 *
 * What each section shows is driven by MemberDisplayState (see
 * components/assignments/MemberDisplayModal), which mirrors the real panel's
 * display config: ordered sections, each with static fields and per-track
 * entities.
 */
import { memo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'

import { AvailabilityTimeline, type TimelineShift } from '@/components/tournament/AvailabilityTimeline'
import { AgeFlagsBadges } from '@/components/tournament/sections/AgeFlagsBadges'
import { Badge } from '@/components/ui/Badge'
import type {
  MembershipAvailability, MembershipEventPreference, MembershipEventPreferenceOption,
  MembershipFull, TournamentShift,
} from '@/lib/api'
import { formatDayLabel, toDateInput } from '@/lib/timeFormat'

import { fieldShown, trackShown, type MemberDisplayState } from '@/components/assignments/MemberDisplayModal'

const HOUR_MS = 3600000

interface FieldProps {
  member: MembershipFull
  display: MemberDisplayState
  /** Every shift the tournament offers — only Availability reads it, but one
   *  signature for every field is what lets FIELDS be a plain list. */
  allShifts: TournamentShift[]
}

function fullName(user: { first_name: string | null; last_name: string | null } | null) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ')
}

function statusVariant(status: string) {
  if (status === 'confirmed') return 'confirmed' as const
  if (status === 'declined') return 'declined' as const
  return 'interested' as const
}

function eventLabel(event: { name: string | null; division: string | null }): string {
  return `${event.name ?? 'Unknown event'}${event.division ? ` ${event.division}` : ''}`
}

// ---------------------------------------------------------------------------
// Section chrome
// ---------------------------------------------------------------------------

/** Input's label styling, verbatim — the card has no room for the panel's
 *  PanelField label/value grid, so this is the only thing naming a value, and
 *  it should sound like every other label in the app. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.07em',
      color: 'var(--color-text-tertiary)',
    }}>
      {children}
    </span>
  )
}

/** One labelled value. The label names the field — Roles, Age, Track Status
 *  — not the panel section it came from: on a card this narrow, "Membership"
 *  over three unrelated badge rows says less than naming each of them. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--font-sans)', fontSize: '11px', color: 'var(--color-text-tertiary)',
    }}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Membership — roles, age, track statuses
// ---------------------------------------------------------------------------
function RolesField({ member }: FieldProps) {
  const roles = member.roles ?? []
  return (
    <Field label="Roles">
      {roles.length === 0 ? <Muted>No roles</Muted> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {/* Plain, not the blue `assigned` variant: a role is what someone
              is, not a status, and colouring it competes with the track
              badges below, where colour actually carries meaning. */}
          {roles.map((role) => <Badge key={role.id} variant="default">{role.label}</Badge>)}
        </div>
      )}
    </Field>
  )
}

function AgeField({ member }: FieldProps) {
  return (
    <Field label="Age">
      <AgeFlagsBadges
        isOver18={member.is_over_18}
        isOver21={member.is_over_21}
        collectIsOver18
        collectIsOver21
        compact
      />
    </Field>
  )
}

function TrackStatusField({ member, display }: FieldProps) {
  const tracks = (member.track_statuses ?? [])
    .filter((t) => trackShown(display, 'track_status', t.track_id))
  return (
    <Field label="Track Status">
      {tracks.length === 0 ? <Muted>No tracks</Muted> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {tracks.map((track) => (
            <Badge key={track.track_id} variant={statusVariant(track.status)}>{track.name}</Badge>
          ))}
        </div>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Event preferences — one block per track, ranks as bullets beside the badge
// ---------------------------------------------------------------------------

/** The rank sits outside the badge. Inside, "1. Chess A" reads as part of the
 *  event's name; outside it is a bullet, and the column of numbers is what
 *  makes the ranking scannable down the card. */
function Rank({ rank }: { rank: number | null }) {
  if (rank === null) return null
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600,
      color: 'var(--color-text-secondary)', flexShrink: 0, minWidth: '12px',
    }}>
      {rank}.
    </span>
  )
}

function OptionRow({ option, open, onToggle }: {
  option: MembershipEventPreferenceOption
  open: boolean
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)

  // A single-event option *is* that event — showing the option's label too
  // would only repeat it. Same rule the panel's section follows.
  if (option.events.length <= 1) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Rank rank={option.rank} />
        {option.events.length === 1
          ? <Badge variant="default">{eventLabel(option.events[0])}</Badge>
          : <Muted>{option.label}</Muted>}
      </div>
    )
  }

  return (
    <div>
      <div
        // The card itself is a draggable; without this the press that opens
        // an option would also start dragging the member onto the board.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
          // Pulled left by its own padding so the text still lines up with
          // the non-expandable rows above and below it.
          padding: '2px 4px', margin: '0 -4px', borderRadius: 'var(--radius-sm)',
          background: hovered ? 'var(--color-accent-subtle)' : 'transparent',
          transition: 'background 120ms ease',
        }}
      >
        <Rank rank={option.rank} />
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: '11px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {option.label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          color: 'var(--color-text-tertiary)', flexShrink: 0,
        }}>
          {option.events.length}
        </span>
      </div>
      {/* 0fr -> 1fr animates to the content's natural height, which a
          max-height transition can't do without a hardcoded guess. */}
      <div style={{
        display: 'grid', gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 180ms ease',
      }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 0 2px 16px' }}>
            {option.events.map((event) => (
              <Badge key={event.id} variant="default">{eventLabel(event)}</Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Open state lives per track, so a track can only have one option expanded.
function PreferenceTrack({ pref }: { pref: MembershipEventPreference }) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
        color: 'var(--color-text-secondary)',
      }}>
        {pref.track_name}
      </span>
      {pref.options.map((option, i) => {
        const id = option.option_id ?? `orphan-${i}`
        return (
          <OptionRow
            key={id}
            option={option}
            open={openId === id}
            onToggle={() => setOpenId((current) => (current === id ? null : id))}
          />
        )
      })}
    </div>
  )
}

function PreferencesField({ member, display }: FieldProps) {
  const prefs = (member.event_preferences ?? [])
    .filter((pref) => trackShown(display, 'event_preferences', pref.track_id))

  return (
    <Field label="Event Preferences">
      {prefs.length === 0 ? <Muted>No preferences given</Muted> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {prefs.map((pref) => <PreferenceTrack key={pref.track_id} pref={pref} />)}
        </div>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Experience — mini tables
// ---------------------------------------------------------------------------

/** Two or three columns of plain text at 10px. The panel uses the full
 *  ExperienceTables spreadsheet, which carries add/edit/delete affordances a
 *  read-only 316px card has no use for. */
function MiniTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
      columnGap: '8px', rowGap: '2px',
    }}>
      {columns.map((column) => (
        <span key={column} style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.04em',
          textTransform: 'uppercase', color: 'var(--color-text-tertiary)',
          borderBottom: '1px solid var(--color-border)', paddingBottom: '2px',
        }}>
          {column}
        </span>
      ))}
      {rows.map((row, i) => row.map((cell, j) => (
        <span
          key={`${i}:${j}`}
          title={cell}
          style={{
            fontFamily: 'var(--font-sans)', fontSize: '11px',
            color: j === 0 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {cell}
        </span>
      )))}
    </div>
  )
}

function CompetitionField({ member, display }: FieldProps) {
  const showSchool = fieldShown(display, 'competition_school')
  const showEvent = fieldShown(display, 'competition_event')
  const rows = member.user?.competition_experience ?? []

  if (!showSchool && !showEvent) return null

  const columns = [...(showEvent ? ['Event'] : []), ...(showSchool ? ['School'] : [])]

  return (
    <Field label="Competition Experience">
      {rows.length === 0 ? <Muted>No info yet</Muted> : (
        <MiniTable
          columns={columns}
          rows={rows.map((row) => [
            ...(showEvent ? [row.event.name] : []),
            ...(showSchool ? [row.school] : []),
          ])}
        />
      )}
    </Field>
  )
}

function VolunteerField({ member, display }: FieldProps) {
  const showWhere = fieldShown(display, 'volunteer_tournament')
  const showEvent = fieldShown(display, 'volunteer_event')
  const showRole = fieldShown(display, 'volunteer_role')
  const rows = member.user?.volunteer_experience ?? []

  if (!showWhere && !showEvent && !showRole) return null

  const columns = [
    ...(showWhere ? ['Tournament'] : []),
    ...(showEvent ? ['Event'] : []),
    ...(showRole ? ['Role'] : []),
  ]

  return (
    <Field label="Volunteer Experience">
      {rows.length === 0 ? <Muted>No info yet</Muted> : (
        <MiniTable
          columns={columns}
          rows={rows.map((row) => [
            // Year and tournament are one column: two columns of four
            // characters and forty would waste the card's whole width on the
            // year's gutter.
            ...(showWhere ? [`'${String(row.year).slice(2)} ${row.tournament_name}`] : []),
            ...(showEvent ? [row.event?.name ?? '—'] : []),
            ...(showRole ? [row.role] : []),
          ])}
        />
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Availability — the panel's timeline, and nothing else
// ---------------------------------------------------------------------------

function groupByDay<T extends { start: string }>(slots: T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>()
  for (const slot of slots) {
    const day = toDateInput(slot.start)
    const group = byDay.get(day)
    if (group) group.push(slot)
    else byDay.set(day, [slot])
  }
  for (const group of byDay.values()) group.sort((a, b) => a.start.localeCompare(b.start))
  return byDay
}

/** Snapped to whole hours so every block on the bar is a full hour wide — a
 *  7:30–6:15 window would otherwise leave slivers at both ends. */
function hourWindow(slots: { start: string; end: string }[]) {
  const starts = slots.map((s) => new Date(s.start).getTime())
  const ends = slots.map((s) => new Date(s.end).getTime())
  return {
    start: Math.floor(Math.min(...starts) / HOUR_MS) * HOUR_MS,
    end: Math.ceil(Math.max(...ends) / HOUR_MS) * HOUR_MS,
  }
}

function toTimelineShifts(slots: MembershipAvailability[]): TimelineShift[] {
  return slots.map((slot) => ({
    id: slot.shift_id,
    label: slot.label,
    start: new Date(slot.start).getTime(),
    end: new Date(slot.end).getTime(),
  }))
}

/** The panel pairs the bar with a badge per shift; here the bar is the whole
 *  section, so the label and time live only in its hover readout. */
function AvailabilityDay({ day, slots, offered }: {
  day: string
  slots: MembershipAvailability[]
  offered: TournamentShift[] | undefined
}) {
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const barWindow = hourWindow(offered?.length ? offered : slots)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: '10px', width: '52px', flexShrink: 0,
        color: 'var(--color-text-secondary)',
      }}>
        {formatDayLabel(day)}
      </span>
      {/* The timeline is written to sit at the far right of a 700px panel row
          and hard-codes a 220px basis; on a card it has to take what is left
          of the width instead. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <AvailabilityTimeline
          dayStart={barWindow.start}
          dayEnd={barWindow.end}
          shifts={toTimelineShifts(slots)}
          hoveredId={hoveredId}
          onHover={setHoveredId}
        />
      </div>
    </div>
  )
}

function AvailabilityField({ member, display, allShifts }: FieldProps) {
  const slots = (member.availability ?? [])
    .filter((slot) => trackShown(display, 'availability', slot.track_id))
  const offeredByDay = groupByDay(allShifts)

  return (
    <Field label="Availability">
      {slots.length === 0 ? <Muted>No info yet</Muted> : (
        <div
          // The bar's hover targets are pointer-driven; letting the press
          // through would start dragging the card off the belt instead.
          onPointerDown={(e) => e.stopPropagation()}
          style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          {[...groupByDay(slots).entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, daySlots]) => (
              <AvailabilityDay
                key={day}
                day={day}
                slots={daySlots}
                offered={offeredByDay.get(day)}
              />
            ))}
        </div>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
/**
 * Card order, fixed. Each entry names the config field that has to be on for
 * it to render; the two experience tables test all of their columns, since
 * they show whenever any one is on and there is no section switch to consult.
 */
const FIELDS: {
  key: string
  shownWhen: (display: MemberDisplayState) => boolean
  render: (props: FieldProps) => React.ReactNode
}[] = [
  { key: 'roles', shownWhen: (d) => fieldShown(d, 'roles'), render: RolesField },
  { key: 'age', shownWhen: (d) => fieldShown(d, 'age'), render: AgeField },
  { key: 'track_status', shownWhen: (d) => fieldShown(d, 'track_status'), render: TrackStatusField },
  { key: 'event_preferences', shownWhen: (d) => fieldShown(d, 'event_preferences'), render: PreferencesField },
  {
    key: 'competition',
    shownWhen: (d) => fieldShown(d, 'competition_school') || fieldShown(d, 'competition_event'),
    render: CompetitionField,
  },
  {
    key: 'volunteer',
    shownWhen: (d) => fieldShown(d, 'volunteer_tournament')
      || fieldShown(d, 'volunteer_event') || fieldShown(d, 'volunteer_role'),
    render: VolunteerField,
  },
  { key: 'availability', shownWhen: (d) => fieldShown(d, 'availability'), render: AvailabilityField },
]

/**
 * The card's contents, memoised away from the draggable shell below.
 *
 * useDraggable subscribes to dnd-kit's internal context, which changes every
 * time the hovered drop target changes — so a card that both calls the hook
 * and renders its own fields re-renders all of them on every crossing, times
 * however many cards are in the belt. The hook stays in the shell; the
 * expensive half lives here, behind props that don't move during a drag.
 */
const MemberCardBody = memo(function MemberCardBody({
  member, display, allShifts,
}: {
  member: MembershipFull
  display: MemberDisplayState
  allShifts: TournamentShift[]
}) {
  return (
    <>
      <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: '13px' }}>
        {fullName(member.user ?? null)}
      </span>
      {FIELDS.filter((field) => field.shownWhen(display)).map(({ key, render: Render }) => (
        <Render key={key} member={member} display={display} allShifts={allShifts} />
      ))}
    </>
  )
})

export function MemberCard({
  member, selected, display, allShifts, onOpen,
}: {
  member: MembershipFull
  selected: boolean
  display: MemberDisplayState
  /** Every shift the tournament offers — sets each availability bar's window,
   *  so hours the member was offered but declined read as unavailable rather
   *  than as absent. */
  allShifts: TournamentShift[]
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `member:${member.id}`,
    data: { kind: 'member', membershipId: member.id },
  })
  const [pressed, setPressed] = useState(false)


  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // A click opens the detail panel, a drag assigns. The PointerSensor's
      // 4px threshold keeps the two apart — below it nothing drags, so
      // onClick still fires.
      onClick={onOpen}
      // Composed with dnd-kit's own handler: {...listeners} already sets
      // onPointerDown, and a second one beside the spread replaces it
      // outright, which silently kills the drag.
      onPointerDown={(e) => {
        setPressed(true)
        const release = () => {
          setPressed(false)
          window.removeEventListener('pointerup', release)
          window.removeEventListener('pointercancel', release)
        }
        window.addEventListener('pointerup', release)
        window.addEventListener('pointercancel', release)
        listeners?.onPointerDown?.(e)
      }}
      style={{
        display: 'flex', flexDirection: 'column', gap: '10px',
        padding: '10px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        // The tint alone marks the open card. An accent border on top of it
        // draws a hard edge around one card in a scrolling column, which
        // reads as an error state rather than as "this is the one you opened".
        background: selected ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
        cursor: pressed || isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1, outline: 'none',
      }}
    >
      <MemberCardBody member={member} display={display} allShifts={allShifts} />
    </div>
  )
}
