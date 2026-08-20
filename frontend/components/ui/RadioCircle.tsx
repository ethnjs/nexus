interface RadioCircleProps {
  checked: boolean
  disabled?: boolean
}

// No shared Radio component exists app-wide (RadioGroup/RadioOption were
// deleted in favor of ButtonGroup), but some contexts specifically need the
// plain "radio circle" look ButtonGroup's pill styling doesn't reproduce —
// e.g. a read-only question preview meant to read as the actual respondent
// layout.
export function RadioCircle({ checked, disabled = false }: RadioCircleProps) {
  // Ring and dot always share one color so a checked circle reads as a single
  // mark: quiet border when unchecked, accent when checked, gray when locked.
  const color = disabled
    ? 'var(--color-text-tertiary)'
    : checked ? 'var(--color-accent)' : 'var(--color-border-strong)'

  return (
    <span style={{
      width: '16px', height: '16px', boxSizing: 'border-box', borderRadius: '50%',
      flexShrink: 0, border: `1.5px solid ${color}`, transition: 'border-color 120ms ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && (
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
      )}
    </span>
  )
}
