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
}

// Plain checkbox list — the fallback for multi-select when option labels
// are too long for ButtonGroup's pill layout to read well.
export function CheckboxList({ options, value, onChange, locked = false }: CheckboxListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {options.map((opt) => (
        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: locked ? 'default' : 'pointer' }}>
          <Checkbox checked={value.includes(opt.value)} locked={locked} onChange={() => onChange(opt.value)} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  )
}
