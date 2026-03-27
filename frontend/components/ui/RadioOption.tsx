interface RadioOptionProps {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  label: string
  description?: string
  mono?: boolean
}

export function RadioOption({ name, value, checked, onChange, label, description, mono = false }: RadioOptionProps) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '10px 12px',
      border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-sm)',
      background: checked ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
      cursor: 'pointer',
      transition: 'border-color 120ms ease, background 120ms ease',
    }}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        style={{ accentColor: 'var(--color-accent)', marginTop: description ? '2px' : '0', flexShrink: 0 }}
      />
      <div>
        <div style={{
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: '12px',
          color: 'var(--color-text-primary)',
        }}>
          {label}
        </div>
        {description && (
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
            marginTop: '2px',
          }}>
            {description}
          </div>
        )}
      </div>
    </label>
  )
}