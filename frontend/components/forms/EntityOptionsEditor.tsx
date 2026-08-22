'use client'

import { useEffect, useState } from 'react'
import {
  tournamentShiftsApi, tournamentEventsApi, TournamentShift, TournamentEvent, Tournament, FormQuestionType, ApiError,
} from '@/lib/api'
import { eventNameWithDivision } from '@/lib/eventDisplay'
import { formatDayLabel, formatTime, toDateInput } from '@/lib/timeFormat'
import { Button } from '@/components/ui/Button'
import { ChipInput } from '@/components/ui/ChipInput'
import { Popover } from '@/components/ui/Popover'
import { IconPlus } from '@/components/ui/Icons'
import { BranchTarget, EditableOption, newEntityOption, OptionsEditor } from '@/components/forms/OptionsEditor'

type EntityFieldKey = 'availability' | 'event_preference'
type Entity = TournamentShift | TournamentEvent

interface EntityOptionsEditorProps {
  fieldKey: EntityFieldKey
  /** id sources shifts/events; is_multi_day decides whether availability's
      shift chips/picker show a day alongside the label (see entityLabel/
      entityTooltip) or fall back to the original label+time-range display —
      a single-day tournament has no day worth disambiguating. */
  tournament: Tournament
  questionType: FormQuestionType
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
  /** single_select_radio/multi_select_checkbox only — same ButtonGroup-style
      row toggle OptionsEditor offers for freeform options. */
  displayStyle?: 'list' | 'buttons'
  /** single_select_radio/single_select_dropdown only — same per-option
      "where does this lead" dropdown OptionsEditor offers for freeform
      options; entity-backed options are still real, addressable rows, so
      there's no reason branching should be freeform-only. */
  branchTargets?: BranchTarget[]
  /** Forwarded straight to OptionsEditor — see its own doc. */
  errors?: string[]
}

// On a multi-day tournament, a shift's label + short day/date is enough to
// tell same-named shifts on different days apart (the ambiguous case) — the
// exact time range is secondary once you've picked one, so it's dropped from
// the visible text and surfaces via entityTooltip instead, on both the chip
// and the picker row, rather than crowding every shift with a full time
// range it usually doesn't need. A single-day tournament has no day worth
// disambiguating, so this falls back to the original label+time-range
// display with no tooltip needed. Events have no day/time of their own here
// (event_preference options aren't day-scoped), so they're unaffected either way.
function entityLabel(fieldKey: EntityFieldKey, entity: Entity, isMultiDay: boolean): string {
  if (fieldKey === 'availability') {
    const shift = entity as TournamentShift
    return isMultiDay
      ? `${shift.label} (${formatDayLabel(toDateInput(shift.start))})`
      : `${shift.label} (${formatTime(shift.start)}–${formatTime(shift.end)})`
  }
  return eventNameWithDivision(entity as TournamentEvent)
}

function entityTooltip(fieldKey: EntityFieldKey, entity: Entity, isMultiDay: boolean): string | undefined {
  if (fieldKey !== 'availability' || !isMultiDay) return undefined
  const shift = entity as TournamentShift
  return `${formatTime(shift.start)}–${formatTime(shift.end)}`
}

// The picker row gets everything inline instead of a tooltip — there's
// plenty of horizontal room in a 280px-wide panel, unlike the chip's own
// tight footprint. Always shows the time range; the day only joins it on a
// multi-day tournament, same disambiguation rule as entityLabel/entityTooltip.
function entityPickerLabel(fieldKey: EntityFieldKey, entity: Entity, isMultiDay: boolean): string {
  if (fieldKey === 'availability') {
    const shift = entity as TournamentShift
    const time = `${formatTime(shift.start)}–${formatTime(shift.end)}`
    return isMultiDay
      ? `${shift.label} (${formatDayLabel(toDateInput(shift.start))}, ${time})`
      : `${shift.label} (${time})`
  }
  return eventNameWithDivision(entity as TournamentEvent)
}

// availability/event_preference variant of OptionsEditor — each option
// groups one or more real tournament entities (TournamentShift or
// TournamentEvent) under a single TD-labeled choice (e.g. "All Day" ->
// [shift 1, shift 2]), stored raw as option.value: number[], rather than
// freeform text. Built directly on OptionsEditor's row shell (grip/bullet/
// label/delete/DnD/displayStyle/branch dropdown) via renderExtra, rather
// than a parallel implementation — the only thing actually different here is
// an *additional* block below the row: a Badge list + Popover checklist
// (reusing the same pattern EventPanel uses for shift attach/detach) sitting
// alongside whatever OptionsEditor already renders for that row.
export function EntityOptionsEditor({ fieldKey, tournament, questionType, options, onChange, displayStyle, branchTargets, errors }: EntityOptionsEditorProps) {
  const [entities, setEntities] = useState<Entity[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setEntities(null);
    setLoadError(null);
    const list = fieldKey === 'availability' ? tournamentShiftsApi.list(tournament.id) : tournamentEventsApi.list(tournament.id)
    list
      .then(setEntities)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : `Failed to load ${fieldKey === 'availability' ? 'shifts' : 'events'}.`))
  }, [fieldKey, tournament.id])

  function toggleEntity(clientKey: string, entityId: number) {
    onChange(options.map((o) => {
      if (o.clientKey !== clientKey) return o
      const ids = Array.isArray(o.value) ? (o.value as number[]) : []
      const next = ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId]
      return { ...o, value: next }
    }))
  }

  if (loadError) {
    return (
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-danger)' }}>
        {loadError}
      </p>
    )
  }

  if (entities === null) {
    return (
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
        Loading {fieldKey === 'availability' ? 'shifts' : 'events'}…
      </p>
    )
  }

  const emptyMessage = fieldKey === 'availability'
    ? 'No shifts on this tournament yet — add some under Events > Shifts.'
    : 'No events on this tournament yet — add some under Events.'

  return (
    <OptionsEditor
      options={options}
      onChange={onChange}
      questionType={questionType}
      placeholder="e.g. All Day"
      createOption={newEntityOption}
      syncValueWithLabel={false}
      displayStyle={displayStyle}
      branchTargets={branchTargets}
      errors={errors}
      renderExtra={(option) => (
        <EntityPicker
          option={option}
          entities={entities}
          fieldKey={fieldKey}
          isMultiDay={tournament.is_multi_day}
          emptyMessage={emptyMessage}
          onToggle={(id) => toggleEntity(option.clientKey, id)}
        />
      )}
    />
  )
}

function EntityPicker({ option, entities, fieldKey, isMultiDay, emptyMessage, onToggle }: {
  option: EditableOption
  entities: Entity[]
  fieldKey: EntityFieldKey
  isMultiDay: boolean
  emptyMessage: string
  onToggle: (id: number) => void
}) {
  const selectedIds = Array.isArray(option.value) ? (option.value as number[]) : []
  const selectedEntities = entities.filter((e) => selectedIds.includes(e.id))

  // disableInput: chips here only ever come from the Popover checklist (the
  // addButton), never typed/pasted — ChipInput's own "x" is still live
  // though, so removing a chip needs mapping back to the entity it came from
  // rather than a free-text diff. Only one chip is ever removed per click
  // (typing is disabled), so the first entity missing from the new chip list
  // is unambiguously the one that was removed.
  function handleChipsChange(chips: string[]) {
    const removed = selectedEntities.find((e) => !chips.includes(entityLabel(fieldKey, e, isMultiDay)))
    if (removed) onToggle(removed.id)
  }

  return (
    <ChipInput
      value={selectedEntities.map((e) => entityLabel(fieldKey, e, isMultiDay))}
      onChange={handleChipsChange}
      disableInput
      variant="transparent"
      size="sm"
      fullWidth
      getChipTooltip={(chip) => {
        const entity = selectedEntities.find((e) => entityLabel(fieldKey, e, isMultiDay) === chip)
        return entity ? entityTooltip(fieldKey, entity, isMultiDay) : undefined
      }}
      addButton={
        <Popover
          trigger={
            <Button type="button" variant="secondary" size="xs">
              <IconPlus size={11} /> {fieldKey === 'availability' ? 'Shifts' : 'Events'}
            </Button>
          }
          items={entities}
          getKey={(e) => e.id}
          renderLabel={(e) => entityPickerLabel(fieldKey, e, isMultiDay)}
          onSelect={(e) => onToggle(e.id)}
          checklist
          isSelected={(e) => selectedIds.includes(e.id)}
          emptyMessage={emptyMessage}
          width={400}
        />
      }
    />
  )
}
