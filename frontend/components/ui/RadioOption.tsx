interface RadioOptionProps {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  label: string
  description?: string
  mono?: boolean
  showCircle?: boolean
  solid?: boolean
  disabled?: boolean
}

export function RadioOption({ name, value, checked, onChange, label, description, mono = true, showCircle = true, solid = false, disabled = false }: RadioOptionProps) {
  const bg    = checked ? (solid ? 'var(--color-accent)' : 'var(--color-accent-subtle)') : 'var(--color-surface)'
  const color = checked && solid ? '#fff' : 'var(--color-text-primary)'

  return (
    <label onClick={() => { if (!disabled) onChange(value) }} style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 12px',
      border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-sm)',
      background: bg,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'color 120ms ease, border-color 120ms ease, background 120ms ease',
    }}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => { if (!disabled) onChange(value) }}
        style={showCircle
          ? { accentColor: 'var(--color-accent)', flexShrink: 0 }
          : { position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none'}
        }
      />
      <div>
        <div style={{
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: '14px',
          color,
        }}>
          {label}
        </div>
        {description && (
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            color: checked && solid ? 'rgba(255,255,255,0.75)' : 'var(--color-text-tertiary)',
            marginTop: '2px',
          }}>
            {description}
          </div>
        )}
      </div>
    </label>
  )
}