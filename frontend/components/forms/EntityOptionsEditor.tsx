'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  tournamentShiftsApi, tournamentEventsApi, tournamentTracksApi, TournamentShift,
  TournamentEvent, TournamentTrack, Tournament, FormQuestionType, ApiError,
  TrackStatus, TrackStatusAssignment,
} from '@/lib/api'
import { eventNameWithDivision } from '@/lib/eventDisplay'
import { formatDayLabel, formatTime, toDateInput } from '@/lib/timeFormat'
import { Button } from '@/components/ui/Button'
import { ChipInput } from '@/components/ui/ChipInput'
import { Popover } from '@/components/ui/Popover'
import { IconChevronDown, IconPlus, IconSearch } from '@/components/ui/Icons'
import { BranchTarget, EditableOption, newEntityOption, OptionsEditor } from '@/components/forms/OptionsEditor'
import { EventOptionsPickerModal } from '@/components/forms/EventOptionsPickerModal'

type EntityFieldKey = 'availability' | 'event_preference' | 'track_status'
type Entity = TournamentShift | TournamentEvent

interface EntityOptionsEditorProps {
  fieldKey: EntityFieldKey
  tournament: Tournament
  questionType: FormQuestionType
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
  displayStyle?: 'list' | 'buttons'
  branchTargets?: BranchTarget[]
  errors?: string[]
  trackStatusEnabled?: boolean
  /** Forwarded to OptionsEditor — whether archiving an option is offered
      alongside removing it. */
  allowArchive?: boolean
}

const STATUS_OPTIONS: { value: TrackStatus; label: string }[] = [
  { value: 'interested', label: 'Interested' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined' },
]
const STATUS_LABEL: Record<TrackStatus | '', string> = {
  '': 'Set status',
  interested: 'Interested',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

function entityLabel(fieldKey: Exclude<EntityFieldKey, 'track_status'>, entity: Entity, isMultiDay: boolean): string {
  if (fieldKey === 'availability') {
    const shift = entity as TournamentShift
    return isMultiDay
      ? `${shift.label} (${formatDayLabel(toDateInput(shift.start))})`
      : `${shift.label} (${formatTime(shift.start)}-${formatTime(shift.end)})`
  }
  return eventNameWithDivision(entity as TournamentEvent)
}

function entityTooltip(fieldKey: Exclude<EntityFieldKey, 'track_status'>, entity: Entity, isMultiDay: boolean): string | undefined {
  if (fieldKey !== 'availability' || !isMultiDay) return undefined
  const shift = entity as TournamentShift
  return `${formatTime(shift.start)}-${formatTime(shift.end)}`
}

function entityPickerLabel(fieldKey: Exclude<EntityFieldKey, 'track_status'>, entity: Entity, isMultiDay: boolean): string {
  if (fieldKey === 'availability') {
    const shift = entity as TournamentShift
    const time = `${formatTime(shift.start)}-${formatTime(shift.end)}`
    return isMultiDay
      ? `${shift.label} (${formatDayLabel(toDateInput(shift.start))}, ${time})`
      : `${shift.label} (${time})`
  }
  return eventNameWithDivision(entity as TournamentEvent)
}

function assignmentsFor(option: EditableOption, availability: boolean): TrackStatusAssignment[] {
  if (availability) {
    return typeof option.value === 'object' && !Array.isArray(option.value)
      ? option.value.track_statuses as TrackStatusAssignment[]
      : []
  }
  return Array.isArray(option.value) ? option.value as TrackStatusAssignment[] : []
}

function shiftIdsFor(option: EditableOption): number[] {
  if (typeof option.value === 'object' && !Array.isArray(option.value)) {
    return option.value.shift_ids ?? []
  }
  return Array.isArray(option.value) ? option.value as number[] : []
}

// Shared options editor for entity-backed presets and Track Status. The only
// difference is whether the row also has a shift/event picker; track chips
// live here for both Track Status and opted-in Availability fields.
export function EntityOptionsEditor({ fieldKey, tournament, questionType, options, onChange, displayStyle, branchTargets, errors, trackStatusEnabled = false, allowArchive = false }: EntityOptionsEditorProps) {
  const isEntity = fieldKey !== 'track_status'
  const hasTracks = fieldKey === 'track_status' || trackStatusEnabled
  const [entities, setEntities] = useState<Entity[] | null>(isEntity ? null : [])
  // Fetched here rather than inside TrackPicker: that renders once per
  // option, so a field with eight choices was making eight identical
  // requests for the same catalog.
  const [tracks, setTracks] = useState<TournamentTrack[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const existingEventIds = useMemo(
    () => new Set(options.flatMap((option) => fieldKey === 'event_preference' ? shiftIdsFor(option) : [])),
    [fieldKey, options],
  )

  useEffect(() => {
    if (!hasTracks) return
    tournamentTracksApi.list(tournament.id).then(setTracks).catch(() => {})
  }, [hasTracks, tournament.id])

  useEffect(() => {
    if (!isEntity) return
    const list = fieldKey === 'availability' ? tournamentShiftsApi.list(tournament.id) : tournamentEventsApi.list(tournament.id)
    list
      .then(setEntities)
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : `Failed to load ${fieldKey === 'availability' ? 'shifts' : 'events'}.`))
  }, [fieldKey, isEntity, tournament.id])

  function toggleEntity(clientKey: string, entityId: number) {
    onChange(options.map((option) => {
      if (option.clientKey !== clientKey) return option
      const ids = shiftIdsFor(option)
      const nextIds = ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId]
      if (fieldKey === 'availability' && trackStatusEnabled) {
        return {
          ...option,
          value: { shift_ids: nextIds, track_statuses: assignmentsFor(option, true) },
        }
      }
      return { ...option, value: nextIds }
    }))
  }

  const loading = entities === null
  const loaded = entities ?? []
  const noun = fieldKey === 'availability' ? 'shifts' : 'events'
  const emptyMessage = loading
    ? `Loading ${noun}...`
    : fieldKey === 'availability'
      ? 'No shifts on this tournament yet - add some under Events > Shifts.'
      : 'No events on this tournament yet - add some under Events.'

  return (
    <>
      {loadError && <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-danger)', marginBottom: '8px' }}>{loadError}</p>}
      <OptionsEditor
        options={options}
        onChange={onChange}
        allowArchive={allowArchive}
        questionType={questionType}
        createOption={isEntity ? newEntityOption : undefined}
        syncValueWithLabel={false}
        displayStyle={displayStyle}
        branchTargets={branchTargets}
        errors={errors}
        renderExtra={(option) => (
          <>
            {isEntity && <EntityPicker
              selectedIds={shiftIdsFor(option)}
              entities={loaded}
              fieldKey={fieldKey as Exclude<EntityFieldKey, 'track_status'>}
              isMultiDay={tournament.is_multi_day}
              emptyMessage={emptyMessage}
              onToggle={(id) => toggleEntity(option.clientKey, id)}
            />}
            {hasTracks && <TrackPicker
              tracks={tracks}
              option={option}
              availability={fieldKey === 'availability'}
              onChange={(next) => onChange(options.map((item) => item.clientKey === next.clientKey ? next : item))}
            />}
          </>
        )}
      />
      {fieldKey === 'event_preference' && loaded.length > 0 && <Button type="button" variant="secondary" size="sm" onClick={() => setShowPicker(true)} style={{ alignSelf: 'flex-start', marginTop: '6px' }}><IconSearch size={12} /> Browse events</Button>}
      {showPicker && <EventOptionsPickerModal
        events={loaded as TournamentEvent[]}
        existingEventIds={existingEventIds}
        onClose={() => setShowPicker(false)}
        onConfirm={(newOptions) => {
          const [first, ...rest] = options
          const firstIsEmptyPlaceholder = first && !first.label.trim() && shiftIdsFor(first).length === 0
          onChange([...(firstIsEmptyPlaceholder ? rest : options), ...newOptions])
        }}
      />}
    </>
  )
}

function EntityPicker({ selectedIds, entities, fieldKey, isMultiDay, emptyMessage, onToggle }: {
  selectedIds: number[]
  entities: Entity[]
  fieldKey: Exclude<EntityFieldKey, 'track_status'>
  isMultiDay: boolean
  emptyMessage: string
  onToggle: (id: number) => void
}) {
  const selectedEntities = entities.filter((entity) => selectedIds.includes(entity.id))
  function handleChipsChange(chips: string[]) {
    const removed = selectedEntities.find((entity) => !chips.includes(entityLabel(fieldKey, entity, isMultiDay)))
    if (removed) onToggle(removed.id)
  }
  return <ChipInput
    value={selectedEntities.map((entity) => entityLabel(fieldKey, entity, isMultiDay))}
    onChange={handleChipsChange}
    disableInput variant="transparent" size="sm" fullWidth
    getChipTooltip={(chip) => {
      const entity = selectedEntities.find((item) => entityLabel(fieldKey, item, isMultiDay) === chip)
      return entity ? entityTooltip(fieldKey, entity, isMultiDay) : undefined
    }}
    addButton={<Popover trigger={<Button type="button" variant="secondary" size="xs"><IconPlus size={11} /> {fieldKey === 'availability' ? 'Shifts' : 'Events'}</Button>} items={entities} getKey={(entity) => entity.id} renderLabel={(entity) => entityPickerLabel(fieldKey, entity, isMultiDay)} onSelect={(entity) => onToggle(entity.id)} checklist isSelected={(entity) => selectedIds.includes(entity.id)} emptyMessage={emptyMessage} width={400} />}
  />
}

function TrackPicker({ tracks, option, availability, onChange }: { tracks: TournamentTrack[]; option: EditableOption; availability: boolean; onChange: (option: EditableOption) => void }) {
  const assignments = assignmentsFor(option, availability)
  const selected = tracks.filter((track) => assignments.some((assignment) => assignment.id === track.id))
  const byName = new Map(selected.map((track) => [track.name, track]))

  function replaceAssignments(nextAssignments: TrackStatusAssignment[]) {
    onChange({
      ...option,
      value: availability
        ? { shift_ids: shiftIdsFor(option), track_statuses: nextAssignments }
        : nextAssignments,
    })
  }
  function toggle(track: TournamentTrack) {
    replaceAssignments(assignments.some((item) => item.id === track.id)
      ? assignments.filter((item) => item.id !== track.id)
      : [...assignments, { id: track.id, status: '' as TrackStatus }])
  }
  function setStatus(trackId: number, status: string) {
    replaceAssignments(assignments.map((item) => item.id === trackId ? { ...item, status: status as TrackStatus } : item))
  }

  return <ChipInput
    value={selected.map((track) => track.name)}
    onChange={(names) => selected.filter((track) => !names.includes(track.name)).forEach(toggle)}
    disableInput variant="transparent" size="sm" fullWidth
    getChipStatus={(name) => assignments.find((item) => item.id === byName.get(name)?.id)?.status ? 'default' : 'error'}
    renderChipTrailing={(name) => {
      const track = byName.get(name)
      const assignment = assignments.find((item) => item.id === track?.id)
      return track && assignment ? <TrackStatusMenu status={assignment.status} onChange={(status) => setStatus(track.id, status)} /> : null
    }}
    addButton={<Popover trigger={<Button type="button" variant="secondary" size="xs"><IconPlus size={11} /> Tracks</Button>} items={tracks.filter((track) => !track.is_archived)} getKey={(track) => track.id} renderLabel={(track) => track.name} onSelect={toggle} checklist isSelected={(track) => assignments.some((item) => item.id === track.id)} emptyMessage="No active tracks." width={300} />}
  />
}

const STATUS_PILL_STYLE: Record<TrackStatus | '', { background: string; color: string; border: string }> = {
  '':          { background: 'var(--color-bg)', color: 'var(--color-text-tertiary)', border: 'var(--color-border-strong)' },
  interested:  { background: 'transparent', color: 'var(--color-text-secondary)', border: 'var(--color-border-strong)' },
  confirmed:   { background: 'var(--color-success-subtle)', color: 'var(--color-success)', border: 'var(--color-success)' },
  declined:    { background: 'var(--color-danger-subtle)', color: 'var(--color-danger)', border: 'var(--color-danger)' },
}

// Right-hand segment of the track chip — a plain clickable pill + chevron
// (not a bordered Dropdown) so it reads as part of the chip itself, not a
// boxed control embedded inside one. Keeps the chip a single fixed height
// matching its neighbors (the Tracks add button) instead of growing to fit
// a full-size Dropdown's own chrome. Colored per status so the chip reads
// at a glance, same palette as Badge's interested/confirmed/declined variants.
function TrackStatusMenu({ status, onChange }: { status: TrackStatus | ''; onChange: (status: TrackStatus) => void }) {
  const [open, setOpen] = useState(false)
  const pill = STATUS_PILL_STYLE[status]
  return (
    <Popover
      trigger={
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '2px', boxSizing: 'border-box',
          padding: '1px 6px', borderRadius: '999px', border: `1px solid ${pill.border}`,
          background: pill.background, color: pill.color,
          fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          {STATUS_LABEL[status]}
          <IconChevronDown size={9} style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </span>
      }
      items={STATUS_OPTIONS}
      getKey={(opt) => opt.value}
      renderLabel={(opt) => opt.label}
      onSelect={(opt) => onChange(opt.value)}
      onOpenChange={setOpen}
      width={140}
      align="left"
    />
  )
}
