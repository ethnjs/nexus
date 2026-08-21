'use client'

import { useEffect, useState } from 'react'
import {
  tournamentShiftsApi, tournamentEventsApi, TournamentShift, TournamentEvent, FormQuestionType, ApiError,
} from '@/lib/api'
import { eventNameWithDivision } from '@/lib/eventDisplay'
import { formatTime } from '@/lib/timeFormat'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Popover } from '@/components/ui/Popover'
import { IconPlus } from '@/components/ui/Icons'
import { BranchTarget, EditableOption, newEntityOption, OptionsEditor } from '@/components/forms/OptionsEditor'

type EntityFieldKey = 'availability' | 'event_preference'
type Entity = TournamentShift | TournamentEvent

interface EntityOptionsEditorProps {
  fieldKey: EntityFieldKey
  tournamentId: number
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

function entityLabel(fieldKey: EntityFieldKey, entity: Entity): string {
  if (fieldKey === 'availability') {
    const shift = entity as TournamentShift
    return `${shift.label} (${formatTime(shift.start)}–${formatTime(shift.end)})`
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
export function EntityOptionsEditor({ fieldKey, tournamentId, questionType, options, onChange, displayStyle, branchTargets, errors }: EntityOptionsEditorProps) {
  const [entities, setEntities] = useState<Entity[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setEntities(null);
    setLoadError(null);
    const list = fieldKey === 'availability' ? tournamentShiftsApi.list(tournamentId) : tournamentEventsApi.list(tournamentId)
    list
      .then(setEntities)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : `Failed to load ${fieldKey === 'availability' ? 'shifts' : 'events'}.`))
  }, [fieldKey, tournamentId])

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
          emptyMessage={emptyMessage}
          onToggle={(id) => toggleEntity(option.clientKey, id)}
        />
      )}
    />
  )
}

function EntityPicker({ option, entities, fieldKey, emptyMessage, onToggle }: {
  option: EditableOption
  entities: Entity[]
  fieldKey: EntityFieldKey
  emptyMessage: string
  onToggle: (id: number) => void
}) {
  const selectedIds = Array.isArray(option.value) ? (option.value as number[]) : []
  const selectedEntities = entities.filter((e) => selectedIds.includes(e.id))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
      {selectedEntities.map((entity) => (
        <Badge key={entity.id} variant="default">
          {entityLabel(fieldKey, entity)}
        </Badge>
      ))}
      <Popover
        trigger={
          <Button type="button" variant="secondary" size="xs">
            <IconPlus size={11} /> {fieldKey === 'availability' ? 'Shifts' : 'Events'}
          </Button>
        }
        items={entities}
        getKey={(e) => e.id}
        renderLabel={(e) => entityLabel(fieldKey, e)}
        onSelect={(e) => onToggle(e.id)}
        checklist
        isSelected={(e) => selectedIds.includes(e.id)}
        emptyMessage={emptyMessage}
        width={280}
      />
    </div>
  )
}
