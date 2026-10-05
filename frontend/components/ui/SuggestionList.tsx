'use client'

import { RefObject, useLayoutEffect, useState } from 'react'

interface SuggestionListProps {
  /** The field the list hangs under. */
  anchorRef: RefObject<HTMLElement | null>
  options: string[]
  /** Index the arrow keys are on, or -1. The caller owns the keys. */
  highlight: number
  onHighlight: (index: number) => void
  onPick: (option: string) => void
}

/**
 * The dropdown of suggestions under an inline text field (EditableCombobox,
 * the events table's location field). Mount it only while there is something
 * to suggest.
 *
 * position: fixed off the field's rect, like Combobox, so a scrolling table
 * or popover can't clip it; re-measured on scroll and resize, since a fixed
 * box doesn't follow its field by itself.
 */
export function SuggestionList({ anchorRef, options, highlight, onHighlight, onPick }: SuggestionListProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, left: r.left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

  if (!pos) return null
  return (
    <div
      role="listbox"
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 400,
        minWidth: '160px', padding: '4px', boxSizing: 'border-box',
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
      }}
    >
      {options.map((option, i) => (
        <div
          key={option}
          role="option"
          aria-selected={i === highlight}
          // mousedown + preventDefault keeps focus in the field, so the pick
          // isn't preceded by a blur that commits the half-typed text.
          onMouseDown={(e) => { e.preventDefault(); onPick(option) }}
          onMouseEnter={() => onHighlight(i)}
          style={{
            padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: '13px', whiteSpace: 'nowrap',
            background: i === highlight ? 'var(--color-accent-subtle)' : undefined,
          }}
        >
          {option}
        </div>
      ))}
    </div>
  )
}
