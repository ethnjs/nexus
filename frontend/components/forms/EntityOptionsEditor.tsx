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
import { IconPlus, IconSearch } from '@/components/ui/Icons'
import { PillMenu, PillTone } from '@/components/ui/PillMenu'
import { BranchTarget, EditableOption, newEntityOption, OptionsEditor } from '@/components/forms/OptionsEditor'
import { EventOptionsPickerModal } from '@/components/forms/EventOptionsPickerModal'

type EntityFieldKey = 'availability' | 'event_preference' | 'track_status'
type Entity = TournamentShift | TournamentEvent

interface EntityOptionsEditorProps {
  fieldKey: EntityFieldKey
  /** The track named in the field's own key — every reserved key but
      track_status carries one. It scopes what the pickers may offer: a
      shift from another track would be written into this track's
      availability pool, and an event that doesn't run on the track has no
      preference to express. Null while the key is still a bare sentinel. */
  trackId?: number | null
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
  /** Called when a picker is used before the question has a track. Opens the
      preset popover, which is where the missing track is both reported and
      fixed — so the pickers don't restate the error in a second place. */
  onRequireTrack?: () => void
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

function assignmentsFor(option: EditableOption): TrackStatusAssignment[] {
  return Array.isArray(option.value) ? option.value as TrackStatusAssignment[] : []
}

/** The status an opted-in availability option sets on the field's own track. */
function statusFor(option: EditableOption): TrackStatus | '' {
  return typeof option.value === 'object' && !Array.isArray(option.value)
    ? ((option.value.track_status ?? '') as TrackStatus | '')
    : ''
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
export function EntityOptionsEditor({ fieldKey, trackId = null, tournament, questionType, options, onChange, displayStyle, branchTargets, errors, trackStatusEnabled = false, allowArchive = false, onRequireTrack }: EntityOptionsEditorProps) {
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
    // Also fetched for availability, which needs only its own track's name
    // for the status row — one request either way.
    if (!hasTracks) return
    tournamentTracksApi.list(tournament.id, { public: true }).then(setTracks).catch(() => {})
  }, [hasTracks, tournament.id])

  const trackName = trackId !== null ? tracks.find((track) => track.id === trackId)?.name : undefined
  // An entity-backed question draws its options from one track's catalog, so
  // there is nothing to pick from until the preset names one.
  const trackMissing = isEntity && trackId === null

  // An event that doesn't run on this question's track can't be offered:
  // the backend rejects the option outright. Greyed with the reason rather
  // than hidden, so a TD looking for it learns why it isn't pickable.
  function offTrackReason(entity: Entity): string | undefined {
    if (fieldKey !== 'event_preference' || trackId === null) return undefined
    const event = entity as TournamentEvent
    return event.tracks.some((track) => track.id === trackId) ? undefined : 'Not on this track'
  }

  useEffect(() => {
    if (!isEntity) return
    // Availability asks the server for the track's shifts; events come back
    // whole, since one that doesn't run on the track is still worth showing
    // as unavailable rather than vanishing (see offTrackReason).
    const list = fieldKey === 'availability'
      ? tournamentShiftsApi.list(tournament.id, trackId !== null ? { trackId } : {})
      : tournamentEventsApi.list(tournament.id)
    list
      .then(setEntities)
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : `Failed to load ${fieldKey === 'availability' ? 'shifts' : 'events'}.`))
  }, [fieldKey, isEntity, trackId, tournament.id])

  function toggleEntity(clientKey: string, entityId: number) {
    onChange(options.map((option) => {
      if (option.clientKey !== clientKey) return option
      const ids = shiftIdsFor(option)
      const nextIds = ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId]
      if (fieldKey === 'availability' && trackStatusEnabled) {
        return { ...option, value: { shift_ids: nextIds, track_status: statusFor(option) } }
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
              disabledReason={offTrackReason}
              onRequireTrack={trackMissing ? onRequireTrack : undefined}
            />}
            {hasTracks && (fieldKey === 'availability' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                  Sets {trackName ?? 'this track'} to
                </span>
                <TrackStatusMenu
                  status={statusFor(option)}
                  onChange={(status) => onChange(options.map((item) => item.clientKey === option.clientKey
                    ? { ...item, value: { shift_ids: shiftIdsFor(item), track_status: status } }
                    : item))}
                />
              </div>
            ) : (
              <TrackPicker
                tracks={tracks}
                option={option}
                onChange={(next) => onChange(options.map((item) => item.clientKey === next.clientKey ? next : item))}
              />
            ))}
          </>
        )}
      />
      {fieldKey === 'event_preference' && loaded.length > 0 && <Button type="button" variant="secondary" size="sm" onClick={() => (trackMissing ? onRequireTrack?.() : setShowPicker(true))} style={{ alignSelf: 'flex-start', marginTop: '6px' }}><IconSearch size={12} /> Browse events</Button>}
      {showPicker && <EventOptionsPickerModal
        events={(loaded as TournamentEvent[]).filter((event) => !offTrackReason(event))}
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

function EntityPicker({ selectedIds, entities, fieldKey, isMultiDay, emptyMessage, onToggle, disabledReason, onRequireTrack }: {
  selectedIds: number[]
  entities: Entity[]
  fieldKey: Exclude<EntityFieldKey, 'track_status'>
  isMultiDay: boolean
  emptyMessage: string
  onToggle: (id: number) => void
  /** Why an entity can't be picked, or undefined when it can. */
  disabledReason?: (entity: Entity) => string | undefined
  /** Set while the question has no track: the add button sends the TD to the
      preset popover instead of opening a list it can't validate against. */
  onRequireTrack?: () => void
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
    addButton={onRequireTrack ? (
      <Button type="button" variant="secondary" size="xs" onClick={onRequireTrack}>
        <IconPlus size={11} /> {fieldKey === 'availability' ? 'Shifts' : 'Events'}
      </Button>
    ) : <Popover trigger={<Button type="button" variant="secondary" size="xs"><IconPlus size={11} /> {fieldKey === 'availability' ? 'Shifts' : 'Events'}</Button>} items={entities} getKey={(entity) => entity.id} renderLabel={(entity) => entityPickerLabel(fieldKey, entity, isMultiDay)} onSelect={(entity) => onToggle(entity.id)} checklist isSelected={(entity) => selectedIds.includes(entity.id)} isDisabled={(entity) => !!disabledReason?.(entity)} disabledReason={disabledReason} emptyMessage={emptyMessage} width={400} />}
  />
}

// track_status_* only — an availability field names one track in its key and
// gets a single status menu instead (see above).
function TrackPicker({ tracks, option, onChange }: { tracks: TournamentTrack[]; option: EditableOption; onChange: (option: EditableOption) => void }) {
  const assignments = assignmentsFor(option)
  const selected = tracks.filter((track) => assignments.some((assignment) => assignment.id === track.id))
  const byName = new Map(selected.map((track) => [track.name, track]))

  function replaceAssignments(nextAssignments: TrackStatusAssignment[]) {
    onChange({ ...option, value: nextAssignments })
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

// Colored per status so the chip reads at a glance, same palette as Badge's
// interested/confirmed/declined variants. An unset status stays muted — it's
// a slot to fill, not an outcome.
const STATUS_TONE: Record<TrackStatus | '', PillTone> = {
  '': 'muted', interested: 'default', confirmed: 'success', declined: 'danger',
}

function TrackStatusMenu({ status, onChange }: { status: TrackStatus | ''; onChange: (status: TrackStatus) => void }) {
  return (
    <PillMenu
      label={STATUS_LABEL[status]}
      tone={STATUS_TONE[status]}
      items={STATUS_OPTIONS}
      getKey={(opt) => opt.value}
      renderLabel={(opt) => opt.label}
      onSelect={(opt) => onChange(opt.value)}
      width={140}
      align="left"
    />
  )
}
