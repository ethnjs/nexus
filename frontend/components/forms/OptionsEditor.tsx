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
import { IconArchive, IconGripVertical, IconRestore, IconX, IconPlus } from '@/components/ui/Icons'

// Same option shape the backend expects, plus a client-only stable id for
// React/dnd-kit — option_id itself is blank ("") for a not-yet-saved option
// (server-assigned on Save, never client-authored per
// form-question-types-reference.md), so it can't double as the list key.
export type EditableOption = FormFieldOption & { clientKey: string }

export function newOption(): EditableOption {
  return { clientKey: crypto.randomUUID(), option_id: '', value: '', label: '' }
}

// EntityOptionsEditor's option shape — value is a to-be-filled entity id
// array, not freeform text (see isEntityBackedPreset).
export function newEntityOption(): EditableOption {
  return { ...newOption(), value: [] }
}

// Which disabled "this is what a respondent sees" bullet to show per row —
// radio/checkbox have a real per-option affordance; dropdown and
// ranked_choice have no bullet of their own while editing (a closed
// Dropdown's panel just lists them in order; RankedList's own rank-number UI
// only shows up on the respondent side), but a numbered list reads better
// here than nothing at all — for ranked_choice it doubles as a preview of
// the rank order options start in before a respondent reorders them.
export type BulletType = 'radio' | 'checkbox' | 'number' | 'none'

export function bulletTypeFor(questionType: FormQuestionType): BulletType {
  if (questionType === 'single_select_radio') return 'radio'
  if (questionType === 'multi_select_checkbox') return 'checkbox'
  if (questionType === 'single_select_dropdown' || questionType === 'ranked_choice') return 'number'
  return 'none'
}

// A field this option could jump to — id is only available once the target
// field has been saved (a draft field's id is null), so unsaved fields show
// up disabled with a reason rather than being silently excluded.
export interface BranchTarget {
  id: string | null
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
  if (value.startsWith(JUMP_PREFIX)) return { ...option, action: null, next_field_id: value.slice(JUMP_PREFIX.length) }
  return { ...option, action: null, next_field_id: null }
}

// Width every number bullet reserves, whatever number it shows.
const NUMBER_BULLET_WIDTH = 24

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
    // Fixed width (fits "99." in 13px mono), not sized to this row's own
    // number — otherwise "20." is wider than "8." and the two rows start
    // their Inputs at different x. inline-block is load-bearing: width is
    // ignored on an inline box, and OptionRow wraps this in a plain div so
    // it isn't a flex item that would get blockified for free.
    return (
      <span style={{
        pointerEvents: 'none', display: 'inline-block', flexShrink: 0,
        width: `${NUMBER_BULLET_WIDTH}px`, textAlign: 'right',
        fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--color-text-tertiary)',
      }}>
        {number}.
      </span>
    )
  }
  if (displayStyle === 'buttons') {
    return (
      <span style={{
        pointerEvents: 'none', display: 'block', flexShrink: 0,
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
  /** How a new row is seeded — plain freeform options default to `newOption()`;
      entity-backed variants start `value` as an id array instead of "". */
  createOption?: () => EditableOption
  /** Freeform options store their respondent-facing text in both `label` and
      `value` — entity-backed variants keep `value` as the selected id array,
      so editing the label shouldn't touch it. */
  syncValueWithLabel?: boolean
  /** Whether archiving an option is offered alongside removing it. Only
      meaningful once the form has responses — see QuestionRenderer. */
  allowArchive?: boolean
  /** This field's validation messages (useFormValidation's per-field issues) —
      only consulted to gate the two option-shaped ones ("needs a label"/
      "must be unique") so a row's own Input.error stays blank until a Save
      attempt actually flagged it, rather than nagging mid-edit. Which row(s)
      get the message is worked out here from the option data itself, not by
      threading a matching clientKey/index through the generic message list. */
  errors?: string[]
}

// Stacked, reorderable option rows for select/ranked question bodies — each
// with its own drag grip (left edge, hover-visible), delete ×, and an
// optional per-row "extra" slot below (branch dropdown by default; entity
// picker for EntityOptionsEditor), plus an "Add option" row below all of
// them. Nested dnd-kit context, scoped to just this field's option list —
// doesn't conflict with the field-level drag context since a field's own
// handle is hidden while its card is expanded.
export function OptionsEditor({
  options, onChange, questionType, displayStyle, branchTargets, renderExtra,
  createOption = newOption, syncValueWithLabel = true, errors = [], allowArchive = false,
}: OptionsEditorProps) {
  // `options` carries archived entries too, but they're not part of the list
  // a respondent sees — they're listed separately below so they don't join
  // drag ordering or take up a bullet number.
  const liveOptions = options.filter((o) => !o.is_archived)
  const archivedOptions = options.filter((o) => o.is_archived)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const bulletType = bulletTypeFor(questionType)

  // Gates, not the per-row verdict itself — a Save attempt found *some* row
  // missing a label / colliding with another, so it's worth checking each
  // row against its own data; before that attempt, these stay false and no
  // row shows red no matter what's typed.
  const flagMissingLabels = errors.includes('Every option needs a label.')
  const flagDuplicateLabels = errors.includes('Option labels must be unique.')
  const duplicateKeys = new Set<string>()
  if (flagDuplicateLabels) {
    const counts = new Map<string, number>()
    for (const o of liveOptions) {
      const key = o.label.trim().toLowerCase()
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const [key, count] of counts) if (count > 1) duplicateKeys.add(key)
  }
  function errorFor(option: EditableOption): string | undefined {
    if (flagMissingLabels && !option.label.trim()) return 'Label is required.'
    if (flagDuplicateLabels && duplicateKeys.has(option.label.trim().toLowerCase())) return 'This label is used by another option.'
    return undefined
  }
  // Set right before inserting a row from Enter, so that row can claim focus
  // once it mounts — a plain "focus the last row" wouldn't work since Enter
  // can be pressed from a row in the middle of the list, not just the end.
  const [focusKey, setFocusKey] = useState<string | null>(null)

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = liveOptions.findIndex((o) => o.clientKey === active.id)
    const newIndex = liveOptions.findIndex((o) => o.clientKey === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange([...arrayMove(liveOptions, oldIndex, newIndex), ...archivedOptions])
  }

  function updateOption(clientKey: string, label: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? { ...o, label, ...(syncValueWithLabel ? { value: label } : {}) } : o)))
  }

  function updateOptionValue(clientKey: string, value: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? { ...o, value } : o)))
  }

  function updateBranch(clientKey: string, value: string) {
    onChange(options.map((o) => (o.clientKey === clientKey ? applyBranchValue(o, value) : o)))
  }

  // A question needs at least one *offerable* option to mean anything, so the
  // last live row can't be removed — only cleared out and edited in place.
  // Archived rows don't count toward that: none of them can be picked.
  function removeOption(clientKey: string) {
    if (liveOptions.length <= 1) return
    onChange(options.filter((o) => o.clientKey !== clientKey))
  }

  // Archiving keeps the option in storage so past answers still resolve, and
  // asks nobody to re-answer — "we ran out", not "this was never valid".
  // Removing it outright is the other verb, and does flag whoever picked it.
  function setArchived(clientKey: string, is_archived: boolean) {
    onChange(options.map((o) => (o.clientKey === clientKey ? { ...o, is_archived } : o)))
  }

  function addOption() {
    onChange([...liveOptions, createOption(), ...archivedOptions])
  }

  // Enter from inside a row inserts right after it, rather than appending at
  // the end — the row you're typing into isn't necessarily the last one.
  function addOptionAfter(clientKey: string) {
    const insertIndex = liveOptions.findIndex((o) => o.clientKey === clientKey) + 1
    const created = createOption()
    const next = [...liveOptions]
    next.splice(insertIndex, 0, created)
    onChange([...next, ...archivedOptions])
    setFocusKey(created.clientKey)
  }

  const trailing = branchTargets
    ? (option: EditableOption) => (
      <BranchDropdown option={option} branchTargets={branchTargets} onChange={(v) => updateBranch(option.clientKey, v)} />
    )
    : undefined

  // renderExtra is an override for variants with their own below-row content
  // (EntityOptionsEditor's picker) — when it's absent and label/value have
  // been un-synced (FieldToolbar's "custom values" toggle), fall back to a
  // plain value Input instead of rendering nothing.
  const extraFor = renderExtra ?? (!syncValueWithLabel
    ? (option: EditableOption) => (
      <Input
        value={typeof option.value === 'string' ? option.value : ''}
        onChange={(e) => updateOptionValue(option.clientKey, e.target.value)}
        placeholder="Value (shown in exports, defaults to label)"
        size="sm"
        fullWidth
      />
    )
    : undefined)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={liveOptions.map((o) => o.clientKey)} strategy={verticalListSortingStrategy}>
          {liveOptions.map((option, index) => (
            <OptionRow
              key={option.clientKey}
              option={option}
              bulletType={bulletType}
              number={index + 1}
              displayStyle={displayStyle}
              trailing={trailing?.(option)}
              extra={extraFor?.(option)}
              error={errorFor(option)}
              canRemove={liveOptions.length > 1}
              allowArchive={allowArchive}
              autoFocus={option.clientKey === focusKey}
              onChange={(label) => updateOption(option.clientKey, label)}
              onRemove={() => removeOption(option.clientKey)}
              onArchive={() => setArchived(option.clientKey, true)}
              onEnter={() => addOptionAfter(option.clientKey)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddOptionRow bulletType={bulletType} number={liveOptions.length + 1} displayStyle={displayStyle} onClick={addOption} />
      <ArchivedOptions
        options={archivedOptions}
        onUnarchive={(clientKey) => setArchived(clientKey, false)}
        onRemove={(clientKey) => onChange(options.filter((o) => o.clientKey !== clientKey))}
      />
    </div>
  )
}

// Options no longer offered, kept so past answers still resolve. Listed apart
// from the live rows rather than dimmed in place: they don't belong in the
// drag order or the bullet numbering, and mixing them in makes it hard to see
// what the question actually asks now.
function ArchivedOptions({ options, onUnarchive, onRemove }: {
  options: EditableOption[]
  onUnarchive: (clientKey: string) => void
  onRemove: (clientKey: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '10px' }}>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.07em',
        color: 'var(--color-text-tertiary)', marginBottom: '2px',
      }}>
        No longer offered
      </span>
      {options.map((option) => (
        <div key={option.clientKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
          <span style={{
            flex: 1, minWidth: 0, fontFamily: 'var(--font-sans)', fontSize: '14px',
            color: 'var(--color-text-tertiary)', textDecoration: 'line-through',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {option.label || 'Untitled option'}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => onUnarchive(option.clientKey)}>
            <IconRestore size={11} /> Offer again
          </Button>
          <Button
            type="button" variant="ghost" size="xs" iconOnly
            title="Remove permanently — anyone who picked it will be asked to answer again"
            onClick={() => onRemove(option.clientKey)}
            style={{ color: 'var(--color-danger)' }}
          >
            <IconX size={11} />
          </Button>
        </div>
      ))}
    </div>
  )
}

// Radio/checkbox/dropdown/ranked_choice questions get a bullet matching the
// option rows above it (Google-Forms-style — it reads as "the next option,"
// not a detached toolbar button, and for dropdown/ranked_choice previews the
// number the next option will get); other types have no per-option bullet to
// echo, so they keep the plain "+ Add option" button.
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
// builds on it purely through OptionsEditor's renderExtra/
// createOption/syncValueWithLabel props rather than rendering its own rows.
function OptionRow({ option, bulletType, number, displayStyle, trailing, extra, error, canRemove, allowArchive, autoFocus, onChange, onRemove, onArchive, onEnter }: {
  option: EditableOption
  bulletType: BulletType
  /** 1-based position — only rendered when bulletType is 'number' (dropdown). */
  number: number
  displayStyle?: 'list' | 'buttons'
  trailing?: ReactNode
  extra?: ReactNode
  error?: string
  canRemove: boolean
  /** Whether "stop offering" is on the table — only meaningful once the form
      has responses worth preserving. */
  allowArchive: boolean
  /** True for the row just inserted by pressing Enter in the row above it. */
  autoFocus: boolean
  onChange: (label: string) => void
  onRemove: () => void
  onArchive: () => void
  onEnter: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.clientKey })
  const [hovered, setHovered] = useState(false)
  // Translate, not Transform — CSS.Transform also emits the scaleX/scaleY
  // dnd-kit derives from the hovered row's rect, which squishes the dragged
  // row whenever rows differ in height (a `trailing`/`extra` slot, wrapped text).
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
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
      // Pairs with the read-only preview's data-option-value: clicking an
      // option on a collapsed card focuses this row's Input (see FieldCard).
      data-option-value={option.option_id}
      style={{ ...style, display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}
    >
      {/* position: relative lives on this row (not the outer column) so the
          grip centers on the row's own height, not the row + extra block
          together — top: 14px was a stale hardcode from before the row grew
          a trailing Dropdown. alignItems is flex-start (not center) so an
          Input.error message growing this row taller doesn't drag the grip/
          bullet/delete down with it — everything here besides the Input is
          hand-centered against just its 36px (md) box instead. */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        {/* No padding added for this — it reaches left into the Card's own
            padding gutter, so the bullet/Input below stay flush with the
            question label Input above them instead of shifting right. */}
        <span
          {...attributes}
          {...listeners}
          style={{
            position: 'absolute', left: '-16px', top: '18px', transform: 'translateY(-50%)',
            display: 'flex', cursor: 'grab', color: 'var(--color-text-tertiary)',
            opacity: hovered ? 1 : 0, transition: 'opacity 100ms ease', touchAction: 'none',
          }}
        >
          <IconGripVertical size={13} />
        </span>
        {/* 9px = (36px Input height - 18px bullet size) / 2 — centers the
            bullet against the Input's own box, same reasoning as the grip above. */}
        <div style={{ marginTop: '9px' }}>
          <Bullet type={bulletType} size={18} number={number} displayStyle={displayStyle} />
        </div>
        <Input
          ref={inputRef}
          value={option.label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Option"
          error={error}
          size="md"
          fullWidth
        />
        {trailing}
        {/* Two verbs, shown together rather than behind a menu: both are one
            click, and seeing them side by side is what makes the difference
            legible. Before any responses exist there's nothing to preserve,
            so only the plain remove appears. */}
        {canRemove && allowArchive && (
          <Button
            type="button" variant="ghost" size="md" iconOnly
            title="Stop offering this option — existing answers stay valid"
            onClick={onArchive}
            style={{ flexShrink: 0 }}
          >
            <IconArchive size={12} />
          </Button>
        )}
        {canRemove && (
          <Button
            type="button" variant="ghost" size="md" iconOnly
            title={allowArchive
              ? "Remove this option — anyone who picked it will be asked to answer again"
              : "Delete option"}
            onClick={onRemove}
            style={{ flexShrink: 0 }}
          >
            <IconX size={12} />
          </Button>
        )}
      </div>
      {/* Indented to match the Input's left edge above, not the row's own —
          otherwise it lines up with the bullet instead (EntityOptionsEditor's
          badge/picker block, offset by the same bullet width + 8px flex gap
          the row above spends before reaching the Input). No offset when
          there's no bullet to line up past. */}
      {extra && (
        <div style={{ marginLeft: bulletType === 'none' ? 0 : `${(bulletType === 'number' ? NUMBER_BULLET_WIDTH : 18) + 8}px` }}>
          {extra}
        </div>
      )}
    </div>
  )
}
