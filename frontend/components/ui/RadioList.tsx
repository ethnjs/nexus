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
}

// Plain radio-circle list — the fallback for single-select when option
// labels are too long for ButtonGroup's pill layout to read well.
export function RadioList({ options, value, onChange, locked = false }: RadioListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {options.map((opt) => (
        <label
          key={opt.value}
          onClick={() => !locked && onChange(opt.value)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: locked ? 'default' : 'pointer' }}
        >
          <RadioCircle checked={value === opt.value} disabled={locked} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  )
}
