'use client'

import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FormFieldOption } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { IconGripVertical, IconX, IconPlus } from '@/components/ui/Icons'

// Same option shape the backend expects, plus a client-only stable id for
// React/dnd-kit — option_id itself is blank ("") for a not-yet-saved option
// (server-assigned on Save, never client-authored per
// form-question-types-reference.md), so it can't double as the list key.
export type EditableOption = FormFieldOption & { clientKey: string }

export function newOption(): EditableOption {
  return { clientKey: crypto.randomUUID(), option_id: '', value: '', label: '' }
}

interface OptionsEditorProps {
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
}

// Stacked, reorderable option rows for select/ranked question bodies — each
// with its own drag grip (left edge, hover-visible) and delete ×, plus an
// "Add option" row below. Nested dnd-kit context, scoped to just this
// field's option list — doesn't conflict with the field-level drag context
// since a field's own handle is hidden while its card is expanded.
export function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = options.findIndex((o) => o.clientKey === active.id)
    const newIndex = options.findIndex((o) => o.clientKey === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(options, oldIndex, newIndex))
  }

  function updateOption(clientKey: string, label: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? { ...o, label, value: label } : o)))
  }

  function removeOption(clientKey: string) {
    onChange(options.filter((o) => o.clientKey !== clientKey))
  }

  function addOption() {
    onChange([...options, newOption()])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={options.map((o) => o.clientKey)} strategy={verticalListSortingStrategy}>
          {options.map((option) => (
            <OptionRow
              key={option.clientKey}
              option={option}
              onChange={(label) => updateOption(option.clientKey, label)}
              onRemove={() => removeOption(option.clientKey)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button type="button" variant="ghost" size="sm" onClick={addOption} style={{ alignSelf: 'flex-start', marginTop: '4px' }}>
        <IconPlus size={12} /> Add option
      </Button>
    </div>
  )
}

function OptionRow({ option, onChange, onRemove }: {
  option: EditableOption
  onChange: (label: string) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.clientKey })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div ref={setNodeRef} style={{ ...style, display: 'flex', alignItems: 'center', gap: '6px' }} className="group">
      <span
        {...attributes}
        {...listeners}
        style={{
          display: 'flex', cursor: 'grab', color: 'var(--color-text-tertiary)',
          padding: '4px', touchAction: 'none',
        }}
      >
        <IconGripVertical size={13} />
      </span>
      <Input
        value={option.label}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Option"
        size="sm"
        fullWidth
      />
      <Button type="button" variant="ghost" size="sm" iconOnly title="Delete option" onClick={onRemove}>
        <IconX size={12} />
      </Button>
    </div>
  )
}
