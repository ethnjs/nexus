interface RadioCircleProps {
  checked: boolean
  disabled?: boolean
  /** Diameter in px. */
  size?: number
}

// No shared Radio component exists app-wide (RadioGroup/RadioOption were
// deleted in favor of ButtonGroup), but some contexts specifically need the
// plain "radio circle" look ButtonGroup's pill styling doesn't reproduce —
// e.g. a read-only question preview meant to read as the actual respondent
// layout.
export function RadioCircle({ checked, disabled = false, size = 16 }: RadioCircleProps) {
  // Ring and dot always share one color so a checked circle reads as a single
  // mark: quiet border when unchecked, accent when checked, gray when locked.
  const color = disabled
    ? 'var(--color-text-tertiary)'
    : checked ? 'var(--color-accent)' : 'var(--color-border-strong)'

  return (
    <span style={{
      width: `${size}px`, height: `${size}px`, boxSizing: 'border-box', borderRadius: '50%',
      flexShrink: 0, border: `2px solid ${color}`, background: 'var(--color-surface)',
      transition: 'border-color 120ms ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && (
        <span style={{ width: `${size / 2}px`, height: `${size / 2}px`, borderRadius: '50%', background: color }} />
      )}
    </span>
  )
}
