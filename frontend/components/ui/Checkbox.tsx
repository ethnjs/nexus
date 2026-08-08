'use client'

// Native input + accentColor, matching RadioOption's approach rather than a
// fully custom control like Toggle.
interface CheckboxProps {
  checked:   boolean
  onChange:  (checked: boolean) => void
  disabled?: boolean
}

export function Checkbox({ checked, onChange, disabled = false }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{
        width:       '16px',
        height:      '16px',
        accentColor: 'var(--color-text-secondary)',
        cursor:      disabled ? 'not-allowed' : 'pointer',
        flexShrink:  0,
      }}
    />
  )
}
