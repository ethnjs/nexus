'use client'

// appearance: none + manual styling rather than the native OS checkbox —
// needed to control border thickness and the unchecked background (a
// native checkbox's box styling isn't stylable that way). Still a real
// <input type="checkbox">, just repainted, so click/keyboard/label
// semantics are unchanged for every existing caller.
interface CheckboxProps {
  checked:  boolean
  onChange: (checked: boolean) => void
  locked?:  boolean
  /** Width/height in px. */
  size?: number
}

// Checkmark is hardcoded white rather than var(--color-text-inverse) —
// CSS custom properties don't resolve inside a data: URI.
const CHECK_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 6l3 3 5-5' fill='none' stroke='white' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'/></svg>`

export function Checkbox({ checked, onChange, locked = false, size = 16 }: CheckboxProps) {
  const color = locked ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)'

  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={locked}
      onChange={(e) => onChange(e.target.checked)}
      style={{
        appearance: 'none',
        WebkitAppearance: 'none',
        margin: 0,
        boxSizing: 'border-box',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '4px',
        border: `2px solid ${color}`,
        backgroundColor: checked ? color : 'var(--color-surface)',
        backgroundImage: checked ? `url("data:image/svg+xml,${encodeURIComponent(CHECK_SVG)}")` : 'none',
        backgroundSize: '85%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        cursor: locked ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    />
  )
}
