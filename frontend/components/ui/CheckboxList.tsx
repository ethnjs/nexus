'use client'

import { Checkbox } from '@/components/ui/Checkbox'

export interface CheckboxListOption {
  value: string
  label: string
}

interface CheckboxListProps {
  options: CheckboxListOption[]
  value: string[]
  /** Called with the clicked option's value — toggle logic (add/remove) is the caller's, same contract as ButtonGroup's multi-select mode. */
  onChange: (value: string) => void
  locked?: boolean
  /** Checkbox size in px. */
  size?: number
  fontSize?: string
  gap?: string
}

// Plain checkbox list — the fallback for multi-select when option labels
// are too long for ButtonGroup's pill layout to read well.
export function CheckboxList({ options, value, onChange, locked = false, size = 16, fontSize = '13px', gap = '8px' }: CheckboxListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {options.map((opt) => (
        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: locked ? 'default' : 'pointer' }}>
          {/* locked rows never show a selection — see RadioList for why value
              comparison alone isn't safe there. */}
          <Checkbox checked={!locked && value.includes(opt.value)} locked={locked} onChange={() => onChange(opt.value)} size={size} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize, color: 'var(--color-text-secondary)' }}>
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  )
}
