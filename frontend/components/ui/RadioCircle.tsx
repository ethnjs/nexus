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
  // Ring and dot always share one color — gray whether checked or not, so
  // selecting an option doesn't change the circle's color, only fills it.
  const color = disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)'

  return (
    <span style={{
      position: 'relative', width: `${size}px`, height: `${size}px`, boxSizing: 'border-box', borderRadius: '50%',
      flexShrink: 0, border: `2px solid ${color}`, background: 'var(--color-surface)',
    }}>
      {/* inset (not a centered fixed-size box) keeps the dot symmetric — a
          centered box splits leftover space in half, which rounds unevenly
          for odd remainders and shows up as a thicker ring edge. */}
      {checked && (
        <span style={{ position: 'absolute', inset: `${size / 6}px`, borderRadius: '50%', background: color }} />
      )}
    </span>
  )
}
