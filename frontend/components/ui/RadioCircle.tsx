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
  return (
    <span style={{
      width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
      border: `1.5px solid ${disabled ? 'var(--color-border-strong)' : 'var(--color-accent)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && (
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: disabled ? 'var(--color-text-tertiary)' : 'var(--color-accent)',
        }} />
      )}
    </span>
  )
}
