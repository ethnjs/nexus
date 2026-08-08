'use client'

import { Button } from "@/components/ui/Button"

export interface ButtonGroupOption {
  value:        string
  label:        string
  description?: string
}

interface ButtonGroupProps {
  options:    ButtonGroupOption[]
  /** A single value for single-select, or an array for multi-select (e.g. Division). */
  value:      string | string[]
  onChange:   (value: string) => void
  direction?: 'row' | 'column'
  size?:      'sm' | 'md'
  locked?:    boolean
  fullWidth?: boolean
}

// Selected/unselected options rendered as primary/secondary Buttons — the
// style used for Division and Visibility, now shared by every yes/no or
// pick-one-of-a-few field instead of a radio-circle list.
export function ButtonGroup({ options, value, onChange, direction = 'row', size = 'sm', locked = false, fullWidth = false }: ButtonGroupProps) {
  const selected = Array.isArray(value) ? value : [value]

  return (
    <div style={{ display: 'flex', flexDirection: direction, gap: '8px', width: fullWidth ? '100%' : undefined }}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value)
        return (
          <Button
            key={opt.value}
            type="button"
            variant={isSelected ? 'primary' : 'secondary'}
            size={size}
            disabled={locked}
            fullWidth={fullWidth}
            onClick={() => onChange(opt.value)}
            style={opt.description ? {
              flexDirection: 'column', alignItems: 'flex-start', height: 'auto',
              padding: '10px 14px', textAlign: 'left', gap: '2px',
            } : undefined}
          >
            <span>{opt.label}</span>
            {opt.description && (
              <span style={{
                fontWeight: 400, fontSize: '12px',
                color: isSelected ? 'rgba(255,255,255,0.75)' : 'var(--color-text-tertiary)',
              }}>
                {opt.description}
              </span>
            )}
          </Button>
        )
      })}
    </div>
  )
}
