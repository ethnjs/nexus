'use client'

import { useState } from 'react'

interface PillInputProps {
  value: number
  /** Fires on Enter or blur with a whole number ≥ `min` that differs from
   *  `value` — not per keystroke, since a commit is usually a save. Anything
   *  else snaps back to `value`. */
  onCommit: (value: number) => void
  min?: number
  disabled?: boolean
  /** Accessible name — the pill has no visible label. */
  label: string
}

/**
 * A tiny number field that sits inside a chip or pill (e.g. a role's head
 * count on a staffing chip): no border or fill of its own, mono digits, and
 * just wide enough for its value — it borrows the chip's look.
 */
export function PillInput({ value, onCommit, min = 1, disabled = false, label }: PillInputProps) {
  const [text, setText] = useState(String(value))
  // Adopt a new value from outside (a save landing) during render — the same
  // derived-state pattern CountInput uses.
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(String(value))
  }

  function commit() {
    const next = Number(text)
    if (Number.isInteger(next) && next >= min && next !== value) onCommit(next)
    else setText(String(value))
  }

  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); setText(String(value)) }
      }}
      onFocus={(e) => e.target.select()}
      style={{
        width: `${Math.max(text.length, 1) + 1}ch`, padding: '0 2px', margin: 0,
        border: 'none', borderBottom: '1px solid var(--color-border-strong)', outline: 'none',
        background: 'transparent', color: 'inherit',
        fontFamily: 'var(--font-mono)', fontSize: 'inherit', textAlign: 'center',
      }}
    />
  )
}
