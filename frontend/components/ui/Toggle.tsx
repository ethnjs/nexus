'use client'

interface ToggleProps {
  checked:  boolean
  onChange: (checked: boolean) => void
  locked?:  boolean
}

export function Toggle({ checked, onChange, locked = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={locked}
      onClick={() => onChange(!checked)}
      style={{
        position:     'relative',
        width:        '36px',
        height:       '20px',
        borderRadius: '999px',
        border:       'none',
        padding:      0,
        cursor:       locked ? 'not-allowed' : 'pointer',
        opacity:      locked ? 0.5 : 1,
        background:   checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
        transition:   'background 120ms ease',
        flexShrink:   0,
      }}
    >
      <span
        style={{
          position:     'absolute',
          top:          '2px',
          left:         checked ? '18px' : '2px',
          width:        '16px',
          height:       '16px',
          borderRadius: '50%',
          background:   '#FFFFFF',
          transition:   'left 120ms ease',
        }}
      />
    </button>
  )
}
