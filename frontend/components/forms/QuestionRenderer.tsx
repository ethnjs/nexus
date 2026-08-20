'use client'

import { FormFieldOption, FormFieldConfig, FormQuestionType } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dropdown } from '@/components/ui/Dropdown'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { RankedList } from '@/components/ui/RankedList'
import { RadioList } from '@/components/ui/RadioList'
import { CheckboxList } from '@/components/ui/CheckboxList'

// Only what rendering actually needs — not the full persisted FormField
// (id, form_id, timestamps, ...), so an in-progress/unsaved draft field in
// the builder (no id yet) can be rendered without a fake id to satisfy the type.
export interface QuestionFieldData {
  label: string
  description: string | null
  question_type: FormQuestionType
  config: FormFieldConfig | null
}

interface QuestionRendererProps {
  field: QuestionFieldData
  /** false = read-only preview (the builder's collapsed card state); true = a real respondent can answer. */
  interactive: boolean
  /** Only consulted when interactive. Shape depends on question_type (string for text types, boolean for acknowledgment, ...). */
  value?: unknown
  onChange?: (value: unknown) => void
  /** Hide the label/description header — e.g. the builder's expanded card already shows the label via its own editable Input, so repeating it here would be redundant. */
  showHeader?: boolean
}

// Shared between the builder's collapsed field-card preview (interactive=false)
// and the eventual /preview and /view pages (interactive=true) — one place
// that knows how each question_type actually renders, so the builder's
// "read-only preview of the real question" doesn't drift from what a
// respondent sees. Reserved-key entity grouping (availability/event_preference)
// doesn't affect this component — it only ever reads an option's `label`,
// never its `value`, which is the only field whose shape differs for those.
export function QuestionRenderer({ field, interactive, value, onChange, showHeader = true }: QuestionRendererProps) {
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

      <QuestionBody field={field} interactive={interactive} value={value} onChange={onChange} />
    </div>
  )
}

function QuestionBody({ field, interactive, value, onChange }: QuestionRendererProps) {
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
