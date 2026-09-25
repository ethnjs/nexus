'use client'

interface SwitchProps {
  checked:  boolean
  onChange: (checked: boolean) => void
  locked?:  boolean
}

// Geometry as constants so the knob stays centred by construction rather
// than by three literals that happen to agree.
const TRACK_W = 36
const TRACK_H = 20
// Divisible by 4 on purpose. At 125% a knob of 14 would be 17.5 device px, so
// one axis rounds to 18 and the other to 17 and it draws as an oval; 16 is a
// whole 20 device px at 125/150/175/200% and stays a circle at any position.
//
// The 2px ring is knowingly uneven: TRACK_H - KNOB is 4px, which is 5 device
// px at 125%, and 5 cannot split in half — so it renders 2/3. No construction
// fixes that (border, flex centring and absolute offset all round the same).
// Equal gaps would need TRACK_H - KNOB divisible by 8, i.e. a 12px knob here
// or a 24px track. shadcn ships the same 1px discrepancy for the same reason.
const KNOB    = 16
const INSET   = (TRACK_H - KNOB) / 2

export function Switch({ checked, onChange, locked = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={locked}
      onClick={() => onChange(!checked)}
      style={{
        position:     'relative',
        width:        `${TRACK_W}px`,
        height:       `${TRACK_H}px`,
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
          top:          `${INSET}px`,
          left:         `${checked ? TRACK_W - KNOB - INSET : INSET}px`,
          width:        `${KNOB}px`,
          height:       `${KNOB}px`,
          borderRadius: '50%',
          // Token, not #FFFFFF: same value today, but a knob hardcoded white
          // would stay white if a dark theme ever redefines the surface.
          background:   'var(--color-surface)',
          transition:   'left 120ms ease',
        }}
      />
    </button>
  )
}
