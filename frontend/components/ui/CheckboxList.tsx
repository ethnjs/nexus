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
  /** Space between rows. */
  gap?: string
  /** Minimum row height. Unset, a row is as tall as its label — set it for a
   *  roomier list like a form question's. */
  rowHeight?: string
  /** Space between the box and its label. */
  labelGap?: string
}

// Plain checkbox list — the fallback for multi-select when option labels
// are too long for ButtonGroup's pill layout to read well.
export function CheckboxList({
  options, value, onChange, locked = false, size = 16, fontSize = '13px',
  gap = '6px', rowHeight, labelGap = '8px',
}: CheckboxListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {options.map((opt) => (
        <CheckboxRow
          key={opt.value}
          option={opt}
          checked={value.includes(opt.value)}
          locked={locked}
          size={size}
          fontSize={fontSize}
          rowHeight={rowHeight}
          labelGap={labelGap}
          onChange={() => !locked && onChange(opt.value)}
        />
      ))}
    </div>
  )
}

function CheckboxRow({ option, checked, locked, size, fontSize, rowHeight, labelGap, onChange }: {
  option: CheckboxListOption
  checked: boolean
  locked: boolean
  size: number
  fontSize: string
  rowHeight?: string
  labelGap: string
  onChange: () => void
}) {
  return (
    <label
      // Lets a read-only preview of this list report which option was
      // clicked (the form builder focuses that option's editor row).
      data-option-value={option.value}
      style={{
        display: 'flex', alignItems: 'center', gap: labelGap, boxSizing: 'border-box',
        // minHeight, not height: a label long enough to wrap would
        // otherwise overflow a fixed-height row.
        minHeight: rowHeight,
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface)',
        cursor: locked ? 'default' : 'pointer',
      }}
    >
      <Checkbox checked={checked} locked={locked} onChange={onChange} size={size} />
      {/* Dimmed to match the box, which already greys itself when locked. */}
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize,
        color: locked ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
      }}>
        {option.label}
      </span>
    </label>
  )
}
