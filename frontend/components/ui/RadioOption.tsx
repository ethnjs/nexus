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
}

export function RadioOption({ name, value, checked, onChange, label, description, mono = true, showCircle = true, solid = false }: RadioOptionProps) {
  const bg    = checked ? (solid ? 'var(--color-accent)' : 'var(--color-accent-subtle)') : 'var(--color-surface)'
  const color = checked && solid ? '#fff' : 'var(--color-text-primary)'

  return (
    <label onClick={() => onChange(value)} style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 12px',
      border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-sm)',
      background: bg,
      cursor: 'pointer',
      transition: 'border-color 120ms ease, background 120ms ease',
    }}>
      {showCircle && (
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={() => onChange(value)}
          style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }}
        />
      )}
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
