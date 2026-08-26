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
import { Dropdown } from '@/components/ui/Dropdown'
import { Popover } from '@/components/ui/Popover'
import { IconPlus, IconSearch } from '@/components/ui/Icons'
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
}

const STATUS_OPTIONS = [
  { value: '', label: 'Choose status' },
  { value: 'interested', label: 'Interested' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined' },
]

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
// difference is whether the row also has a shift/event picker; track outcome
// chips live here for both Track Status and opted-in Availability fields.
export function EntityOptionsEditor({ fieldKey, tournament, questionType, options, onChange, displayStyle, branchTargets, errors, trackStatusEnabled = false }: EntityOptionsEditorProps) {
  const isEntity = fieldKey !== 'track_status'
  const hasTrackOutcomes = fieldKey === 'track_status' || trackStatusEnabled
  const [entities, setEntities] = useState<Entity[] | null>(isEntity ? null : [])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const existingEventIds = useMemo(
    () => new Set(options.flatMap((option) => fieldKey === 'event_preference' ? shiftIdsFor(option) : [])),
    [fieldKey, options],
  )

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
            {hasTrackOutcomes && <TrackOutcomePicker
              tournament={tournament}
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

function TrackOutcomePicker({ tournament, option, availability, onChange }: { tournament: Tournament; option: EditableOption; availability: boolean; onChange: (option: EditableOption) => void }) {
  const [tracks, setTracks] = useState<TournamentTrack[]>([])
  useEffect(() => { tournamentTracksApi.list(tournament.id).then(setTracks).catch(() => {}) }, [tournament.id])
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
    label="Track outcomes"
    value={selected.map((track) => track.name)}
    onChange={(names) => selected.filter((track) => !names.includes(track.name)).forEach(toggle)}
    disableInput variant="transparent" size="sm" fullWidth
    getChipStatus={(name) => assignments.find((item) => item.id === byName.get(name)?.id)?.status ? 'default' : 'error'}
    renderChipTrailing={(name) => {
      const track = byName.get(name)
      const assignment = assignments.find((item) => item.id === track?.id)
      return track && assignment ? <Dropdown value={assignment.status} onChange={(status) => setStatus(track.id, status)} options={STATUS_OPTIONS} size="sm" width={132} /> : null
    }}
    addButton={<Popover trigger={<Button type="button" variant="secondary" size="xs"><IconPlus size={11} /> Tracks</Button>} items={tracks.filter((track) => !track.is_archived)} getKey={(track) => track.id} renderLabel={(track) => track.name} onSelect={toggle} checklist isSelected={(track) => assignments.some((item) => item.id === track.id)} emptyMessage="No active tracks." width={300} />}
  />
}
