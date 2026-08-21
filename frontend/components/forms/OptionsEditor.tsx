'use client'

import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react'
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
// radio/checkbox have a real per-option affordance; dropdown has no bullet
// of its own once picked, but a numbered list reads better while editing
// than nothing at all (it's the order the closed Dropdown's panel lists
// them in); ranked_choice doesn't render one inline like this (RankedList
// has its own rank-number UI on the respondent side).
export type BulletType = 'radio' | 'checkbox' | 'number' | 'none'

export function bulletTypeFor(questionType: FormQuestionType): BulletType {
  if (questionType === 'single_select_radio') return 'radio'
  if (questionType === 'multi_select_checkbox') return 'checkbox'
  if (questionType === 'single_select_dropdown') return 'number'
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

// The "this is what a respondent sees" bullet — purely decorative, so
// pointerEvents: none keeps the row's own cursor (not RadioCircle/
// Checkbox's disabled/locked "not-allowed") when hovering over it. In
// buttons display_style, a respondent doesn't see a radio/checkbox at all
// (ButtonGroup has no per-option bullet), so this switches to a small
// unselected-chip swatch instead — echoing the ButtonGroup pill shape here
// is what actually makes toggling display_style visible while you're still
// looking at the editor, not just in a preview you've scrolled away from.
function Bullet({ type, size, number, displayStyle }: { type: BulletType; size: number; number?: number; displayStyle?: 'list' | 'buttons' }) {
  if (type === 'none') return null
  if (type === 'number') {
    return (
      <span style={{
        pointerEvents: 'none', flexShrink: 0, minWidth: `${size}px`, textAlign: 'right',
        fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--color-text-tertiary)',
      }}>
        {number}.
      </span>
    )
  }
  if (displayStyle === 'buttons') {
    return (
      <span style={{
        pointerEvents: 'none', flexShrink: 0,
        width: `${size + 6}px`, height: `${size}px`,
        border: '1px solid var(--color-border-strong)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface)',
      }} />
    )
  }
  return (
    <span style={{ pointerEvents: 'none', display: 'flex' }}>
      {type === 'radio'
        ? <RadioCircle checked={false} disabled size={size} />
        : <Checkbox checked={false} onChange={() => {}} locked size={size} />}
    </span>
  )
}

// Inline, right-aligned in the option's own row (Google-Forms-style — a
// jump target reads as part of the option, not a separate settings block
// hanging underneath it), rather than a full-width Dropdown on its own line.
function BranchDropdown({ option, branchTargets, onChange }: {
  option: EditableOption
  branchTargets: BranchTarget[]
  onChange: (value: string) => void
}) {
  const branchOptions: DropdownOption[] = [
    { value: CONTINUE_VALUE, label: 'Continue to next question' },
    ...branchTargets.map((t): DropdownOption => ({
      value: t.id != null ? `${JUMP_PREFIX}${t.id}` : `${JUMP_PREFIX}unsaved:${t.label}`,
      label: `Jump to: ${t.label}`,
      disabled: t.id == null,
      subtitle: t.id == null ? 'Save the form to enable this target' : undefined,
    })),
    { value: SUBMIT_VALUE, label: 'Submit form' },
  ]

  return <Dropdown value={branchValueFor(option)} onChange={onChange} options={branchOptions} size="md" width={190} variant="primary" />
}

interface OptionsEditorProps {
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
  questionType: FormQuestionType
  /** single_select_radio/multi_select_checkbox only — swaps the row bullets
      to a chip swatch echoing ButtonGroup's pill shape, since the "list vs
      buttons" toggle otherwise has no visible effect while you're editing. */
  displayStyle?: 'list' | 'buttons'
  /** Only meaningful for single_select_radio/dropdown — renders a per-option
      "where does this lead" Dropdown inline at the right edge of the row
      when set. */
  branchTargets?: BranchTarget[]
  /** Escape hatch for a variant that needs different below-row content than
      the branch dropdown — e.g. EntityOptionsEditor's entity picker. */
  renderExtra?: (option: EditableOption) => ReactNode
  /** Row label placeholder — "Option" for freeform choices, something more
      specific (e.g. "e.g. All Day") for entity-backed variants. */
  placeholder?: string
  /** How a new row is seeded — plain freeform options default to `newOption()`;
      entity-backed variants start `value` as an id array instead of "". */
  createOption?: () => EditableOption
  /** Freeform options store their respondent-facing text in both `label` and
      `value` — entity-backed variants keep `value` as the selected id array,
      so editing the label shouldn't touch it. */
  syncValueWithLabel?: boolean
}

// Stacked, reorderable option rows for select/ranked question bodies — each
// with its own drag grip (left edge, hover-visible), delete ×, and an
// optional per-row "extra" slot below (branch dropdown by default; entity
// picker for EntityOptionsEditor), plus an "Add option" row below all of
// them. Nested dnd-kit context, scoped to just this field's option list —
// doesn't conflict with the field-level drag context since a field's own
// handle is hidden while its card is expanded.
export function OptionsEditor({
  options, onChange, questionType, displayStyle, branchTargets, renderExtra, placeholder = 'Option',
  createOption = newOption, syncValueWithLabel = true,
}: OptionsEditorProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const bulletType = bulletTypeFor(questionType)
  // Set right before inserting a row from Enter, so that row can claim focus
  // once it mounts — a plain "focus the last row" wouldn't work since Enter
  // can be pressed from a row in the middle of the list, not just the end.
  const [focusKey, setFocusKey] = useState<string | null>(null)

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = options.findIndex((o) => o.clientKey === active.id)
    const newIndex = options.findIndex((o) => o.clientKey === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(options, oldIndex, newIndex))
  }

  function updateOption(clientKey: string, label: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? { ...o, label, ...(syncValueWithLabel ? { value: label } : {}) } : o)))
  }

  function updateBranch(clientKey: string, value: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? applyBranchValue(o, value) : o)))
  }

  // A question needs at least one option to mean anything, so the last row
  // can't be deleted — only cleared out and edited in place.
  function removeOption(clientKey: string) {
    if (options.length <= 1) return
    onChange(options.filter((o) => o.clientKey !== clientKey))
  }

  function addOption() {
    onChange([...options, createOption()])
  }

  // Enter from inside a row inserts right after it, rather than appending at
  // the end — the row you're typing into isn't necessarily the last one.
  function addOptionAfter(clientKey: string) {
    const insertIndex = options.findIndex((o) => o.clientKey === clientKey) + 1
    const created = createOption()
    const next = [...options]
    next.splice(insertIndex, 0, created)
    onChange(next)
    setFocusKey(created.clientKey)
  }

  const trailing = branchTargets
    ? (option: EditableOption) => (
      <BranchDropdown option={option} branchTargets={branchTargets} onChange={(v) => updateBranch(option.clientKey, v)} />
    )
    : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={options.map((o) => o.clientKey)} strategy={verticalListSortingStrategy}>
          {options.map((option, index) => (
            <OptionRow
              key={option.clientKey}
              option={option}
              bulletType={bulletType}
              number={index + 1}
              displayStyle={displayStyle}
              placeholder={placeholder}
              trailing={trailing?.(option)}
              extra={renderExtra?.(option)}
              canRemove={options.length > 1}
              autoFocus={option.clientKey === focusKey}
              onChange={(label) => updateOption(option.clientKey, label)}
              onRemove={() => removeOption(option.clientKey)}
              onEnter={() => addOptionAfter(option.clientKey)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddOptionRow bulletType={bulletType} number={options.length + 1} displayStyle={displayStyle} onClick={addOption} />
    </div>
  )
}

// Radio/checkbox/dropdown questions get a bullet matching the option rows
// above it (Google-Forms-style — it reads as "the next option," not a
// detached toolbar button, and for dropdown previews the number the next
// option will get); ranked_choice has no per-option bullet to echo, so it
// keeps the plain "+ Add option" button.
function AddOptionRow({ bulletType, number, displayStyle, onClick }: {
  bulletType: BulletType; number: number; displayStyle?: 'list' | 'buttons'; onClick: () => void
}) {
  if (bulletType === 'none') {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onClick} style={{ alignSelf: 'flex-start', marginTop: '6px' }}>
        <IconPlus size={12} /> Add option
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
      <Bullet type={bulletType} size={18} number={number} displayStyle={displayStyle} />
      <Button type="button" variant="ghost" size="sm" onClick={onClick} style={{ color: 'var(--color-text-tertiary)' }}>
        Add option
      </Button>
    </div>
  )
}

// The shared row shell — grip, bullet, label input, delete, an optional
// inline `trailing` slot at the row's right edge (the branch dropdown), and
// an optional `extra` block below the row (EntityOptionsEditor's picker).
// This is "the general look" every options list shares; EntityOptionsEditor
// builds on it purely through OptionsEditor's renderExtra/placeholder/
// createOption/syncValueWithLabel props rather than rendering its own rows.
function OptionRow({ option, bulletType, number, displayStyle, placeholder, trailing, extra, canRemove, autoFocus, onChange, onRemove, onEnter }: {
  option: EditableOption
  bulletType: BulletType
  /** 1-based position — only rendered when bulletType is 'number' (dropdown). */
  number: number
  displayStyle?: 'list' | 'buttons'
  placeholder: string
  trailing?: ReactNode
  extra?: ReactNode
  canRemove: boolean
  /** True for the row just inserted by pressing Enter in the row above it. */
  autoFocus: boolean
  onChange: (label: string) => void
  onRemove: () => void
  onEnter: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.clientKey })
  const [hovered, setHovered] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
    // Only on this row's mount — it's created already flagged autoFocus, so
    // there's nothing to react to later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    onEnter()
  }

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...style, display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}
    >
      {/* position: relative lives on this row (not the outer column) so the
          grip centers on the row's own height, not the row + extra block
          together — top: 14px was a stale hardcode from before the row grew
          a trailing Dropdown. */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* No padding added for this — it reaches left into the Card's own
            padding gutter, so the bullet/Input below stay flush with the
            question label Input above them instead of shifting right. */}
        <span
          {...attributes}
          {...listeners}
          style={{
            position: 'absolute', left: '-16px', top: '50%', transform: 'translateY(-50%)',
            display: 'flex', cursor: 'grab', color: 'var(--color-text-tertiary)',
            opacity: hovered ? 1 : 0, transition: 'opacity 100ms ease', touchAction: 'none',
          }}
        >
          <IconGripVertical size={13} />
        </span>
        <Bullet type={bulletType} size={18} number={number} displayStyle={displayStyle} />
        <Input
          ref={inputRef}
          value={option.label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          size="md"
          fullWidth
        />
        {canRemove && (
          <Button type="button" variant="ghost" size="md" iconOnly title="Delete option" onClick={onRemove}>
            <IconX size={12} />
          </Button>
        )}
        {trailing}
      </div>
      {extra}
    </div>
  )
}
