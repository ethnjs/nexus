'use client'

import { FormFieldOption, FormFieldConfig, FormQuestionType } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dropdown } from '@/components/ui/Dropdown'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { Toggle } from '@/components/ui/Toggle'
import { RankedList } from '@/components/ui/RankedList'
import { RadioList } from '@/components/ui/RadioList'
import { CheckboxList } from '@/components/ui/CheckboxList'
import { OptionsEditor, EditableOption, BranchTarget } from '@/components/forms/OptionsEditor'
import { EntityOptionsEditor } from '@/components/forms/EntityOptionsEditor'
import { activePreset, parseLunchFieldKey, buildLunchFieldKey } from '@/lib/forms/fieldKeyPresets'
import { OPTION_BEARING_TYPES, BRANCHING_TYPES } from '@/lib/forms/fieldTypes'

// Only what rendering actually needs — not the full persisted FormField
// (id, form_id, timestamps, ...), so an in-progress/unsaved draft field in
// the builder (no id yet) can be rendered without a fake id to satisfy the type.
// field_key is optional and only consulted by edit mode (reserved presets —
// availability/event_preference/lunch — key off it); view mode never reads it.
export interface QuestionFieldData {
  label: string
  description: string | null
  question_type: FormQuestionType
  config: FormFieldConfig | null
  field_key?: string
}

type FieldUpdate = Partial<QuestionFieldData>

interface QuestionRendererProps {
  field: QuestionFieldData
  /** 'view' (default) = respondent-facing rendering, either a live answer widget
      (interactive) or a read-only preview. 'edit' = the TD-facing config editor
      for this question_type's body (options list, ranks, confirm text, ...). */
  mode?: 'view' | 'edit'
  /** view mode only. false = read-only preview (the builder's collapsed card
      state); true = a real respondent can answer. */
  interactive?: boolean
  /** view mode only. Shape depends on question_type (string for text types,
      boolean for acknowledgment, ...). */
  value?: unknown
  onChange?: (value: unknown) => void
  /** Hide the label/description header — e.g. the builder's expanded card already
      shows the label via its own editable Input, so repeating it here would be
      redundant. */
  showHeader?: boolean
  /** edit mode only — applies a partial update to the field being edited. */
  onFieldChange?: (updates: FieldUpdate) => void
  /** edit mode only — tournament scope for the availability/event_preference
      presets' entity-backed options. null/undefined hides those presets' editor
      (falls through to the plain preview instead). */
  tournamentId?: number | null
  /** edit mode only — candidate "jump to" fields for single_select_radio/dropdown's
      per-option branching. Omitted (or empty) hides the branch dropdown. */
  branchTargets?: BranchTarget[]
  /** edit mode only — whether branching is currently toggled on for this field
      (the toggle itself lives outside QuestionRenderer, e.g. FieldCard's Popover). */
  branchingEnabled?: boolean
}

// Shared between the builder's field-card preview/editor (mode='view'/'edit')
// and the eventual /preview and /view pages (mode='view', interactive=true) —
// one place that knows how each question_type both answers and edits, so the
// builder's editor and a respondent's view never drift apart. Reserved-key
// entity grouping (availability/event_preference) doesn't affect view mode —
// it only ever reads an option's `label`, never its `value`, which is the
// only field whose shape differs for those.
export function QuestionRenderer({
  field, mode = 'view', interactive = false, value, onChange, showHeader = true,
  onFieldChange, tournamentId, branchTargets, branchingEnabled,
}: QuestionRendererProps) {
  const config = field.config ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {showHeader && (
        <div>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {field.label || 'Untitled question'}
            {config.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
          </span>
          {field.description && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              {field.description}
            </p>
          )}
        </div>
      )}

      {mode === 'edit' ? (
        <QuestionEditBody
          field={field}
          onFieldChange={onFieldChange ?? (() => {})}
          tournamentId={tournamentId ?? null}
          branchTargets={branchTargets}
          branchingEnabled={branchingEnabled}
        />
      ) : (
        <QuestionBody field={field} interactive={interactive} value={value} onChange={onChange} />
      )}
    </div>
  )
}

function QuestionBody({ field, interactive, value, onChange }: {
  field: QuestionFieldData
  interactive?: boolean
  value?: unknown
  onChange?: (value: unknown) => void
}) {
  const config = field.config ?? {}

  switch (field.question_type) {
    case 'short_text':
      return (
        <Input
          value={interactive ? (value as string | undefined) ?? '' : ''}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={interactive ? undefined : 'Short answer'}
          locked={!interactive}
          fullWidth
        />
      )

    case 'long_text':
      return (
        <Textarea
          value={interactive ? (value as string | undefined) ?? '' : ''}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={interactive ? undefined : 'Long answer'}
          disabled={!interactive}
          rows={3}
          fullWidth
        />
      )

    case 'acknowledgment':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: interactive ? 'pointer' : 'default' }}>
          <Checkbox
            checked={interactive ? Boolean(value) : false}
            onChange={(checked) => onChange?.(checked)}
            locked={!interactive}
            size={18}
          />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            {config.confirm_label || 'I understand'}
          </span>
        </label>
      )

    case 'single_select_radio': {
      const options: FormFieldOption[] = config.options ?? []
      const selected = interactive ? (value as string | undefined) ?? '' : ''

      if (config.display_style === 'buttons') {
        return (
          <ButtonGroup
            options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
            value={selected}
            onChange={(v) => interactive && onChange?.(v)}
            locked={!interactive}
          />
        )
      }

      return (
        <RadioList
          options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
          value={selected}
          onChange={(v) => interactive && onChange?.(v)}
          locked={!interactive}
          size={18}
          fontSize="14px"
          gap="10px"
        />
      )
    }

    case 'single_select_dropdown': {
      const options: FormFieldOption[] = config.options ?? []
      return (
        <Dropdown
          value={interactive ? (value as string | undefined) ?? '' : ''}
          onChange={(v) => onChange?.(v)}
          options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
          placeholder="Choose"
          locked={!interactive}
          fullWidth
        />
      )
    }

    case 'multi_select_checkbox': {
      const options: FormFieldOption[] = config.options ?? []
      const selected = interactive ? ((value as string[] | undefined) ?? []) : []

      function toggle(optionId: string) {
        if (!interactive) return
        onChange?.(selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId])
      }

      if (config.display_style === 'buttons') {
        return (
          <ButtonGroup
            options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
            value={selected}
            onChange={toggle}
            locked={!interactive}
          />
        )
      }

      return (
        <CheckboxList
          options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
          value={selected}
          onChange={toggle}
          locked={!interactive}
          size={18}
          fontSize="14px"
          gap="10px"
        />
      )
    }

    case 'ranked_choice': {
      const options: FormFieldOption[] = config.options ?? []
      const ranks = config.ranks ?? options.length
      return (
        <RankedList
          options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
          ranks={ranks}
          value={interactive ? (value as Record<string, string> | undefined) ?? {} : {}}
          onChange={(next) => interactive && onChange?.(next)}
          locked={!interactive}
        />
      )
    }

    default:
      // reserved lunch_* config bodies (date + category picker) — not wired up yet.
      return (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          Preview not available for &ldquo;{field.question_type}&rdquo; yet.
        </p>
      )
  }
}

// The TD-facing counterpart to QuestionBody — same question_type switch, but
// each branch renders that type's config editor instead of an answer widget.
// Reserved presets (availability/event_preference/lunch) override the plain
// option-bearing-type editor since their options come from real tournament
// data or a derived field_key rather than freeform rows.
function QuestionEditBody({ field, onFieldChange, tournamentId, branchTargets, branchingEnabled }: {
  field: QuestionFieldData
  onFieldChange: (updates: FieldUpdate) => void
  tournamentId: number | null
  branchTargets?: BranchTarget[]
  branchingEnabled?: boolean
}) {
  const preset = activePreset(field.field_key ?? '')
  const supportsBranching = !preset && BRANCHING_TYPES.includes(field.question_type)

  if ((preset?.key === 'availability' || preset?.key === 'event_preference') && tournamentId) {
    return (
      <EntityOptionsEditor
        fieldKey={preset.key}
        tournamentId={tournamentId}
        questionType={field.question_type}
        options={(field.config?.options as EditableOption[] | undefined) ?? []}
        onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
      />
    )
  }

  if (preset?.key === 'lunch') {
    return <LunchFieldBody field={field} onFieldChange={onFieldChange} />
  }

  if (field.question_type === 'acknowledgment') {
    return <AcknowledgmentBody field={field} onFieldChange={onFieldChange} />
  }

  if (!preset && OPTION_BEARING_TYPES.includes(field.question_type)) {
    return (
      <>
        <OptionsEditor
          options={(field.config?.options as EditableOption[] | undefined) ?? []}
          onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
          questionType={field.question_type}
          displayStyle={field.config?.display_style}
          branchTargets={supportsBranching && branchingEnabled ? branchTargets : undefined}
        />
        {field.question_type === 'ranked_choice' && (
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'flex-end', gap: '20px' }}>
            <div style={{ width: '100px' }}>
              <Input
                label="Ranks"
                type="number"
                min={1}
                value={String(field.config?.ranks ?? 1)}
                onChange={(e) => onFieldChange({ config: { ...field.config, ranks: Math.max(1, Number(e.target.value) || 1) } })}
                size="sm"
                fullWidth
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '9px' }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                Allow duplicate ranks
              </span>
              <Toggle
                checked={!!field.config?.allow_duplicates}
                onChange={(checked) => onFieldChange({ config: { ...field.config, allow_duplicates: checked } })}
              />
            </div>
          </div>
        )}
      </>
    )
  }

  return <QuestionBody field={field} interactive={false} />
}

// Lunch's edit body: a date + category picker (the field-level key
// derivation), not a per-option picker — the options below are just that
// lunch's food choices, edited with the same freeform OptionsEditor as any
// other select/checkbox field.
function LunchFieldBody({ field, onFieldChange }: {
  field: QuestionFieldData
  onFieldChange: (updates: FieldUpdate) => void
}) {
  const fieldKey = field.field_key ?? 'lunch_'
  const { date, category } = parseLunchFieldKey(fieldKey)

  function setDate(newDate: string) {
    onFieldChange({ field_key: buildLunchFieldKey(newDate, category) })
  }

  function setCategory(newCategory: string) {
    onFieldChange({ field_key: buildLunchFieldKey(date, newCategory) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '10px' }}>
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} size="sm" fullWidth />
        <Input label="Category" placeholder="e.g. Protein" value={category} onChange={(e) => setCategory(e.target.value)} size="sm" fullWidth />
      </div>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
        {fieldKey === 'lunch_' ? 'Set a date and category to derive the field key' : fieldKey}
      </p>
      <OptionsEditor
        options={(field.config?.options as EditableOption[] | undefined) ?? []}
        onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
        questionType={field.question_type}
        displayStyle={field.config?.display_style}
      />
    </div>
  )
}

// Acknowledgment's edit body — the one piece of its config with no default
// on the backend (AcknowledgmentConfig.confirm_label has no fallback, unlike
// every other type-specific config key here), so it needs a real editor
// rather than silently defaulting at save time like ranks/allow_duplicates.
function AcknowledgmentBody({ field, onFieldChange }: {
  field: QuestionFieldData
  onFieldChange: (updates: FieldUpdate) => void
}) {
  return (
    <Input
      label="Confirmation text"
      value={field.config?.confirm_label ?? ''}
      onChange={(e) => onFieldChange({ config: { ...field.config, confirm_label: e.target.value } })}
      placeholder="I understand and agree to the above"
      size="sm"
      fullWidth
    />
  )
}
