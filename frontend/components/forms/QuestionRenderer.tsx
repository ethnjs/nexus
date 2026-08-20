'use client'

import { FormField } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'

interface QuestionRendererProps {
  field: FormField
  /** false = read-only preview (the builder's collapsed card state); true = a real respondent can answer. */
  interactive: boolean
  /** Only consulted when interactive. Shape depends on question_type (string for text types, boolean for acknowledgment, ...). */
  value?: unknown
  onChange?: (value: unknown) => void
}

// Shared between the builder's collapsed field-card preview (interactive=false)
// and the eventual /preview and /view pages (interactive=true) — one place
// that knows how each question_type actually renders, so the builder's
// "read-only preview of the real question" doesn't drift from what a
// respondent sees. Only short_text/long_text/acknowledgment are wired up so
// far; select/ranked/reserved types land in a later step.
export function QuestionRenderer({ field, interactive, value, onChange }: QuestionRendererProps) {
  const config = field.config ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {field.label || 'Untitled question'}
          {config.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
        </span>
        {field.description && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            {field.description}
          </p>
        )}
      </div>

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
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: interactive ? 'pointer' : 'default' }}>
          <Checkbox
            checked={interactive ? Boolean(value) : false}
            onChange={(checked) => onChange?.(checked)}
            locked={!interactive}
          />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {config.confirm_label || 'I understand'}
          </span>
        </label>
      )

    default:
      // select/ranked/reserved types — not wired up yet.
      return (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          Preview not available for &ldquo;{field.question_type}&rdquo; yet.
        </p>
      )
  }
}
