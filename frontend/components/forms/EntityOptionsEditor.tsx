'use client'

import { useEffect, useState } from 'react'
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  tournamentShiftsApi, tournamentEventsApi, TournamentShift, TournamentEvent, FormQuestionType, ApiError,
} from '@/lib/api'
import { eventNameWithDivision } from '@/lib/eventDisplay'
import { formatTime } from '@/lib/timeFormat'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Popover } from '@/components/ui/Popover'
import { RadioCircle } from '@/components/ui/RadioCircle'
import { Checkbox } from '@/components/ui/Checkbox'
import { IconGripVertical, IconX, IconPlus } from '@/components/ui/Icons'
import { EditableOption, newOption, BulletType, bulletTypeFor } from '@/components/forms/OptionsEditor'

type EntityFieldKey = 'availability' | 'event_preference'
type Entity = TournamentShift | TournamentEvent

interface EntityOptionsEditorProps {
  fieldKey: EntityFieldKey
  tournamentId: number
  questionType: FormQuestionType
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
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
// freeform text. Reuses Popover's checklist mode — the same pattern
// EventPanel uses for shift attach/detach — instead of a new picker.
export function EntityOptionsEditor({ fieldKey, tournamentId, questionType, options, onChange }: EntityOptionsEditorProps) {
  const [entities, setEntities] = useState<Entity[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const bulletType = bulletTypeFor(questionType)

  useEffect(() => {
    setEntities(null);
    setLoadError(null);
    const list = fieldKey === 'availability' ? tournamentShiftsApi.list(tournamentId) : tournamentEventsApi.list(tournamentId)
    list
      .then(setEntities)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : `Failed to load ${fieldKey === 'availability' ? 'shifts' : 'events'}.`))
  }, [fieldKey, tournamentId])

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = options.findIndex((o) => o.clientKey === active.id)
    const newIndex = options.findIndex((o) => o.clientKey === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(options, oldIndex, newIndex))
  }

  function updateLabel(clientKey: string, label: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? { ...o, label } : o)))
  }

  function toggleEntity(clientKey: string, entityId: number) {
    onChange(options.map((o) => {
      if (o.clientKey !== clientKey) return o
      const ids = Array.isArray(o.value) ? (o.value as number[]) : []
      const next = ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId]
      return { ...o, value: next }
    }))
  }

  function removeOption(clientKey: string) {
    onChange(options.filter((o) => o.clientKey !== clientKey))
  }

  function addOption() {
    onChange([...options, { ...newOption(), value: [] }])
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={options.map((o) => o.clientKey)} strategy={verticalListSortingStrategy}>
          {options.map((option) => (
            <EntityOptionRow
              key={option.clientKey}
              option={option}
              entities={entities}
              fieldKey={fieldKey}
              bulletType={bulletType}
              emptyMessage={emptyMessage}
              onLabelChange={(label) => updateLabel(option.clientKey, label)}
              onToggleEntity={(id) => toggleEntity(option.clientKey, id)}
              onRemove={() => removeOption(option.clientKey)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button type="button" variant="ghost" size="sm" onClick={addOption} style={{ alignSelf: 'flex-start' }}>
        <IconPlus size={12} /> Add option
      </Button>
    </div>
  )
}

function EntityOptionRow({ option, entities, fieldKey, bulletType, emptyMessage, onLabelChange, onToggleEntity, onRemove }: {
  option: EditableOption
  entities: Entity[]
  fieldKey: EntityFieldKey
  bulletType: BulletType
  emptyMessage: string
  onLabelChange: (label: string) => void
  onToggleEntity: (id: number) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.clientKey })
  const [hovered, setHovered] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const selectedIds = Array.isArray(option.value) ? (option.value as number[]) : []
  const selectedEntities = entities.filter((e) => selectedIds.includes(e.id))

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...style, position: 'relative', padding: '6px 0' }}
    >
      <span
        {...attributes}
        {...listeners}
        style={{
          position: 'absolute', left: '-16px', top: '10px',
          display: 'flex', cursor: 'grab', color: 'var(--color-text-tertiary)',
          opacity: hovered ? 1 : 0, transition: 'opacity 100ms ease', touchAction: 'none',
        }}
      >
        <IconGripVertical size={13} />
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {bulletType === 'radio' && <RadioCircle checked={false} disabled />}
        {bulletType === 'checkbox' && <Checkbox checked={false} onChange={() => {}} locked />}
        <Input
          value={option.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="e.g. All Day"
          size="sm"
          fullWidth
        />
        <Button type="button" variant="ghost" size="sm" iconOnly title="Delete option" onClick={onRemove}>
          <IconX size={12} />
        </Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
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
          onSelect={(e) => onToggleEntity(e.id)}
          checklist
          isSelected={(e) => selectedIds.includes(e.id)}
          emptyMessage={emptyMessage}
          width={280}
        />
      </div>
    </div>
  )
}
