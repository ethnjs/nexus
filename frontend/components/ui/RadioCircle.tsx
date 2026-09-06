interface RadioCircleProps {
  checked: boolean
  disabled?: boolean
  /** Diameter in px. */
  size?: number
}

// Drawn in a 20-unit box and scaled by the SVG, so every dimension stays
// proportional at any size.
const VIEWBOX = 20
const STROKE_PX = 2
const DOT_RADIUS = 4.5

// No shared Radio component exists app-wide (RadioGroup/RadioOption were
// deleted in favor of ButtonGroup), but some contexts specifically need the
// plain "radio circle" look ButtonGroup's pill styling doesn't reproduce —
// e.g. a read-only question preview meant to read as the actual respondent
// layout.
//
// SVG rather than a bordered <span>: a CSS border rounds to whole device
// pixels per edge, so at fractional zoom / DPR the ring comes out thicker on
// one side and the whole circle reads as warped. An SVG circle antialiases
// symmetrically instead, and because the element has an intrinsic aspect
// ratio, a flex or grid parent that stretches the box letterboxes the
// drawing rather than turning it into an oval.
export function RadioCircle({ checked, disabled = false, size = 16 }: RadioCircleProps) {
  // Ring and dot always share one color — gray whether checked or not, so
  // selecting an option doesn't change the circle's color, only fills it.
  const color = disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)'
  // Constant apparent thickness: user units shrink as `size` grows.
  const stroke = (STROKE_PX * VIEWBOX) / size

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      aria-hidden="true"
      // flex: 0 0 auto + align-self stop a flex parent resizing the box at
      // all; display: block keeps it off the inline text baseline.
      style={{ display: 'block', flex: '0 0 auto', alignSelf: 'center', overflow: 'visible' }}
    >
      {/* Stroke straddles the path, so the radius is inset by half of it to
          keep the ring inside the declared size. */}
      <circle
        cx={VIEWBOX / 2}
        cy={VIEWBOX / 2}
        r={VIEWBOX / 2 - stroke / 2}
        fill="var(--color-surface)"
        stroke={color}
        strokeWidth={stroke}
      />
      {checked && <circle cx={VIEWBOX / 2} cy={VIEWBOX / 2} r={DOT_RADIUS} fill={color} />}
    </svg>
  )
}
