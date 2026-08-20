'use client'

import { RadioCircle } from '@/components/ui/RadioCircle'

export interface RadioListOption {
  value: string
  label: string
}

interface RadioListProps {
  options: RadioListOption[]
  value: string
  onChange: (value: string) => void
  locked?: boolean
  /** Radio circle diameter in px. */
  size?: number
  fontSize?: string
  gap?: string
}

// Plain radio-circle list — the fallback for single-select when option
// labels are too long for ButtonGroup's pill layout to read well.
export function RadioList({ options, value, onChange, locked = false, size = 16, fontSize = '13px', gap = '8px' }: RadioListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {options.map((opt) => (
        <label
          key={opt.value}
          onClick={() => !locked && onChange(opt.value)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: locked ? 'default' : 'pointer' }}
        >
          {/* locked rows never show a selection — value comparison alone
              isn't safe there (e.g. multiple not-yet-saved options can all
              share an empty option_id, which would otherwise all "match"
              an empty value at once). */}
          <RadioCircle checked={!locked && value === opt.value} disabled={locked} size={size} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize, color: 'var(--color-text-secondary)' }}>
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  )
}
