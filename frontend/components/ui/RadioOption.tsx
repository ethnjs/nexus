interface RadioOptionProps {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  label: string
  mono?: boolean
}

export function RadioOption({ name, value, checked, onChange, label, mono = false }: RadioOptionProps) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 12px',
      border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-sm)',
      background: checked ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
      cursor: 'pointer',
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontSize: '12px',
      color: 'var(--color-text-primary)',
      transition: 'border-color 120ms ease, background 120ms ease',
    }}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        style={{ accentColor: 'var(--color-accent)' }}
      />
      {label}
    </label>
  )
}