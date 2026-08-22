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

const ROW_HEIGHT = '36px'

// Plain radio-circle list — the fallback for single-select when option
// labels are too long for ButtonGroup's pill layout to read well.
export function RadioList({ options, value, onChange, locked = false, size = 16, fontSize = '13px', gap = '8px' }: RadioListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {options.map((opt) => (
        <RadioRow
          key={opt.value}
          option={opt}
          checked={!locked && value === opt.value}
          locked={locked}
          size={size}
          fontSize={fontSize}
          onClick={() => !locked && onChange(opt.value)}
        />
      ))}
    </div>
  )
}

function RadioRow({ option, checked, locked, size, fontSize, onClick }: {
  option: RadioListOption
  checked: boolean
  locked: boolean
  size: number
  fontSize: string
  onClick: () => void
}) {
  return (
    <label
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '16px', boxSizing: 'border-box',
        height: ROW_HEIGHT,
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface)',
        cursor: locked ? 'default' : 'pointer',
      }}
    >
      {/* locked rows never show a selection — value comparison alone
          isn't safe there (e.g. multiple not-yet-saved options can all
          share an empty option_id, which would otherwise all "match"
          an empty value at once). */}
      <RadioCircle checked={checked} disabled={locked} size={size} />
      <span style={{ fontFamily: 'var(--font-sans)', fontSize, color: 'var(--color-text-primary)' }}>
        {option.label}
      </span>
    </label>
  )
}
