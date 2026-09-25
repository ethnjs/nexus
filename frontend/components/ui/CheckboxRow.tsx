'use client'

import { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import { Checkbox } from '@/components/ui/Checkbox'

/**
 * An even whole-px line box for a row label.
 *
 * 13px at line-height 1.5 is 19.5px, so rows stack at fractional heights and
 * every other one starts on a half pixel — which resamples the tick and makes
 * it sit higher in some rows than others. Rounding up to an even number keeps
 * the row height and the centred checkbox on integers.
 */
export function evenLineBox(fontSize: string): string {
  const px = parseFloat(fontSize)
  return Number.isFinite(px) ? `${Math.ceil((px * 1.5) / 2) * 2}px` : '1.5'
}

export interface CheckboxRowProps {
  checked: boolean
  onChange: () => void
  label: ReactNode
  locked?: boolean
  /** Checkbox width/height in px. Even numbers stay on the pixel grid. */
  size?: number
  fontSize?: string
  /** Space between the box and its label. */
  gap?: string
  /** Replaces the checkbox — e.g. a lock icon on a row that can't be toggled. */
  control?: ReactNode
  labelColor?: string
  /** Merged onto the row. Padding, background and radius go here: they're
   *  per-list chrome, not the row geometry this component owns. */
  style?: CSSProperties
  /** Lets a read-only preview report which option was clicked. */
  dataOptionValue?: string
  onMouseEnter?: (e: ReactMouseEvent<HTMLLabelElement>) => void
  onMouseLeave?: () => void
}

/**
 * One checkbox-and-label row.
 *
 * The single place that owns the vertical geometry every checkbox list
 * depends on, so a new list can't reintroduce fractional row heights by
 * hand-rolling its own label markup.
 */
export function CheckboxRow({
  checked, onChange, label, locked = false, size = 16, fontSize = '13px',
  gap = '8px', control, labelColor, style, dataOptionValue, onMouseEnter, onMouseLeave,
}: CheckboxRowProps) {
  return (
    <label
      data-option-value={dataOptionValue}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display: 'flex', alignItems: 'center', gap, boxSizing: 'border-box',
        cursor: locked ? 'default' : 'pointer',
        ...style,
      }}
    >
      {control ?? <Checkbox checked={checked} locked={locked} onChange={onChange} size={size} />}
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize, lineHeight: evenLineBox(fontSize),
        color: labelColor ?? (locked ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)'),
      }}>
        {label}
      </span>
    </label>
  )
}
