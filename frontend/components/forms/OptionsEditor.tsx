'use client'

import { useState } from 'react'
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FormFieldOption, FormQuestionType } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dropdown, DropdownOption } from '@/components/ui/Dropdown'
import { RadioCircle } from '@/components/ui/RadioCircle'
import { Checkbox } from '@/components/ui/Checkbox'
import { IconGripVertical, IconX, IconPlus } from '@/components/ui/Icons'

// Same option shape the backend expects, plus a client-only stable id for
// React/dnd-kit — option_id itself is blank ("") for a not-yet-saved option
// (server-assigned on Save, never client-authored per
// form-question-types-reference.md), so it can't double as the list key.
export type EditableOption = FormFieldOption & { clientKey: string }

export function newOption(): EditableOption {
  return { clientKey: crypto.randomUUID(), option_id: '', value: '', label: '' }
}

// Which disabled "this is what a respondent sees" bullet to show per row —
// only single_select_radio/multi_select_checkbox have a real per-option
// affordance; dropdown and ranked_choice don't render one inline like this.
// Shared with EntityOptionsEditor (availability/event_preference reuse the
// same question_types, just with entity-backed options).
export type BulletType = 'radio' | 'checkbox' | 'none'

export function bulletTypeFor(questionType: FormQuestionType): BulletType {
  if (questionType === 'single_select_radio') return 'radio'
  if (questionType === 'multi_select_checkbox') return 'checkbox'
  return 'none'
}

// A field this option could jump to — id is only available once the target
// field has been saved (a draft field's id is null), so unsaved fields show
// up disabled with a reason rather than being silently excluded.
export interface BranchTarget {
  id: number | null
  label: string
}

const CONTINUE_VALUE = '__continue__'
const SUBMIT_VALUE = '__submit__'
const JUMP_PREFIX = 'jump:'

function branchValueFor(option: FormFieldOption): string {
  if (option.action === 'submit_form') return SUBMIT_VALUE
  if (option.next_field_id != null) return `${JUMP_PREFIX}${option.next_field_id}`
  return CONTINUE_VALUE
}

function applyBranchValue(option: EditableOption, value: string): EditableOption {
  if (value === SUBMIT_VALUE) return { ...option, action: 'submit_form', next_field_id: null }
  if (value.startsWith(JUMP_PREFIX)) return { ...option, action: null, next_field_id: Number(value.slice(JUMP_PREFIX.length)) }
  return { ...option, action: null, next_field_id: null }
}

interface OptionsEditorProps {
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
  questionType: FormQuestionType
  /** Only meaningful for single_select_radio/dropdown — renders a per-option
      "where does this lead" Dropdown below each row when set. */
  branchTargets?: BranchTarget[]
}

// Stacked, reorderable option rows for select/ranked question bodies — each
// with its own drag grip (left edge, hover-visible) and delete ×, plus an
// "Add option" row below. Nested dnd-kit context, scoped to just this
// field's option list — doesn't conflict with the field-level drag context
// since a field's own handle is hidden while its card is expanded.
export function OptionsEditor({ options, onChange, questionType, branchTargets }: OptionsEditorProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const bulletType = bulletTypeFor(questionType)

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

  function updateBranch(clientKey: string, value: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? applyBranchValue(o, value) : o)))
  }

  function removeOption(clientKey: string) {
    onChange(options.filter((o) => o.clientKey !== clientKey))
  }

  function addOption() {
    onChange([...options, newOption()])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={options.map((o) => o.clientKey)} strategy={verticalListSortingStrategy}>
          {options.map((option) => (
            <OptionRow
              key={option.clientKey}
              option={option}
              bulletType={bulletType}
              branchTargets={branchTargets}
              onChange={(label) => updateOption(option.clientKey, label)}
              onBranchChange={(value) => updateBranch(option.clientKey, value)}
              onRemove={() => removeOption(option.clientKey)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button type="button" variant="ghost" size="sm" onClick={addOption} style={{ alignSelf: 'flex-start', marginTop: '6px' }}>
        <IconPlus size={12} /> Add option
      </Button>
    </div>
  )
}

function OptionRow({ option, bulletType, branchTargets, onChange, onBranchChange, onRemove }: {
  option: EditableOption
  bulletType: BulletType
  branchTargets?: BranchTarget[]
  onChange: (label: string) => void
  onBranchChange: (value: string) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.clientKey })
  const [hovered, setHovered] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const branchOptions: DropdownOption[] | undefined = branchTargets && [
    { value: CONTINUE_VALUE, label: 'Continue to next question' },
    ...branchTargets.map((t): DropdownOption => ({
      value: t.id != null ? `${JUMP_PREFIX}${t.id}` : `${JUMP_PREFIX}unsaved:${t.label}`,
      label: `Jump to: ${t.label}`,
      disabled: t.id == null,
      subtitle: t.id == null ? 'Save the form to enable this target' : undefined,
    })),
    { value: SUBMIT_VALUE, label: 'Submit form' },
  ]

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '4px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* No padding added for this — it reaches left into the Card's own
            padding gutter, so the bullet/Input below stay flush with the
            question label Input above them instead of shifting right. */}
        <span
          {...attributes}
          {...listeners}
          style={{
            position: 'absolute', left: '-16px', top: '14px', transform: 'translateY(-50%)',
            display: 'flex', cursor: 'grab', color: 'var(--color-text-tertiary)',
            opacity: hovered ? 1 : 0, transition: 'opacity 100ms ease', touchAction: 'none',
          }}
        >
          <IconGripVertical size={13} />
        </span>
        {bulletType === 'radio' && <RadioCircle checked={false} disabled size={18} />}
        {bulletType === 'checkbox' && <Checkbox checked={false} onChange={() => {}} locked size={18} />}
        <Input
          value={option.label}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Option"
          size="md"
          fullWidth
        />
        <Button type="button" variant="ghost" size="sm" iconOnly title="Delete option" onClick={onRemove}>
          <IconX size={12} />
        </Button>
      </div>
      {branchOptions && (
        <div style={{ marginLeft: bulletType === 'none' ? 0 : 26, width: 220 }}>
          <Dropdown
            value={branchValueFor(option)}
            onChange={onBranchChange}
            options={branchOptions}
            size="sm"
          />
        </div>
      )}
    </div>
  )
}
