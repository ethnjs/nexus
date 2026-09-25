'use client'

import { CheckboxRow } from '@/components/ui/CheckboxRow'

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
  /** Space between rows. */
  gap?: string
  /** Minimum row height. Unset, a row is as tall as its label — set it for a
   *  roomier list like a form question's. */
  rowHeight?: string
  /** Space between the box and its label. */
  labelGap?: string
}

// Plain checkbox list — the fallback for multi-select when option labels
// are too long for ButtonGroup's pill layout to read well. Rows come from
// CheckboxRow, which owns the line box that keeps them on whole pixels.
export function CheckboxList({
  options, value, onChange, locked = false, size = 16, fontSize = '13px',
  gap = '6px', rowHeight, labelGap = '8px',
}: CheckboxListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {options.map((opt) => (
        <CheckboxRow
          key={opt.value}
          label={opt.label}
          dataOptionValue={opt.value}
          checked={value.includes(opt.value)}
          locked={locked}
          size={size}
          fontSize={fontSize}
          gap={labelGap}
          onChange={() => !locked && onChange(opt.value)}
          style={{
            // minHeight, not height: a label long enough to wrap would
            // otherwise overflow a fixed-height row.
            minHeight: rowHeight,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            cursor: locked ? 'default' : 'pointer',
          }}
        />
      ))}
    </div>
  )
}
