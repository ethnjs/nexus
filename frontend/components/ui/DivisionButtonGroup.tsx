'use client'

import { CSSProperties, useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { ButtonGroupOption } from '@/components/ui/ButtonGroup'

const DIVISION_TOKEN: Record<string, string> = { A: 'division-a', B: 'division-b', C: 'division-c' }

interface DivisionButtonGroupProps {
  /** Plain options; any whose value is a division (A/B/C) wears that
   *  division's colours, anything else ("No division") stays neutral. */
  options: ButtonGroupOption[]
  /** A single value for single-select, or an array for multi-select. */
  value: string | string[]
  onChange: (value: string) => void
  size?: 'sm' | 'md'
  locked?: boolean
}

/**
 * ButtonGroup for divisions — same props, but each division button is
 * coloured like its badge so A/B/C read at a glance. Selected is the solid
 * colour; unselected its subtle tint. Hover strengthens the edge (unselected)
 * or darkens the fill (selected) — set here, since Button's own hover would
 * repaint the colours with the neutral ones.
 */
export function DivisionButtonGroup({ options, value, onChange, size = 'sm', locked = false }: DivisionButtonGroupProps) {
  const selected = Array.isArray(value) ? value : [value]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {options.map((opt) => (
        <DivisionButton
          key={opt.value}
          option={opt}
          selected={selected.includes(opt.value)}
          size={size}
          locked={locked}
          onClick={() => onChange(opt.value)}
        />
      ))}
    </div>
  )
}

function DivisionButton({ option, selected, size, locked, onClick }: {
  option: ButtonGroupOption
  selected: boolean
  size: 'sm' | 'md'
  locked: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const token = DIVISION_TOKEN[option.value]
  const hover = hovered && !locked

  // Not a division: the ordinary ButtonGroup look, Button's hover included.
  if (!token) {
    return (
      <Button type="button" variant={selected ? 'primary' : 'secondary'} size={size} disabled={locked} onClick={onClick}>
        {option.label}
      </Button>
    )
  }

  const style: CSSProperties = selected
    ? {
        backgroundColor: `var(--color-${token})`, borderColor: `var(--color-${token})`,
        color: 'var(--color-text-inverse)', filter: hover ? 'brightness(0.9)' : undefined,
      }
    : {
        backgroundColor: `var(--color-${token}-subtle)`, color: `var(--color-${token})`,
        borderColor: hover ? `var(--color-${token})` : `var(--color-${token}-subtle)`,
      }

  return (
    <Button
      type="button" variant="secondary" size={size} interactive={false} disabled={locked}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...style, transition: 'background-color 120ms ease, border-color 120ms ease, filter 120ms ease' }}
    >
      {option.label}
    </Button>
  )
}
