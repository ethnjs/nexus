'use client'

import { forwardRef, ButtonHTMLAttributes, useState } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size    = 'xs' | 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:     Variant
  size?:        Size
  loading?:     boolean
  fullWidth?:   boolean
  /** Square button sized to its height, for a lone icon with no label. */
  iconOnly?:    boolean
  /**
   * When true (default), the button applies a subtle hover background shift.
   * Set to false to suppress hover styling — useful when the parent manages
   * hover state itself.
   */
  interactive?: boolean
}

// Longhand borderWidth/Style/Color rather than the `border` shorthand, so
// hoverOverrides below can set borderColor alone without clobbering the
// other two.
const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--color-accent)',
    color:        'var(--color-text-inverse)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-accent)',
  },
  secondary: {
    backgroundColor: 'var(--color-surface)',
    color:        'var(--color-text-primary)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-border)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color:        'var(--color-text-primary)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'transparent',
  },
  danger: {
    backgroundColor: 'var(--color-danger)',
    color:        'var(--color-text-inverse)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-danger)',
  },
}

// Every hover token gets an explicit var() fallback to the variant's own
// resting color. If a token is ever missing at runtime the declaration is
// invalid at computed-value time, which resolves to the *initial* value —
// transparent for background-color — so a filled button silently goes
// see-through on hover instead of just not shifting shade. (Exactly that
// happened when a stale Turbopack dev CSS chunk was missing
// --color-danger-hover.) The fallback makes the failure mode "no hover
// effect" rather than "button disappears."

/** Background applied on hover per variant */
const variantHoverBg: Record<Variant, string> = {
  primary:   'var(--color-accent-hover, var(--color-accent))',
  secondary: 'var(--color-accent-subtle, var(--color-surface))',
  ghost:     'var(--color-accent-subtle, transparent)',
  danger:    'var(--color-danger-hover, var(--color-danger))',
}

/** Border color applied on hover (null = no change) */
const variantHoverBorderColor: Record<Variant, string | null> = {
  primary:   'var(--color-accent-hover, var(--color-accent))',
  secondary: 'var(--color-border-strong, var(--color-border))',
  ghost:     null,
  danger:    'var(--color-danger-hover, var(--color-danger))',
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  xs: { height: '26px', padding: '0 10px', fontSize: '11px', gap: '4px' },
  sm: { height: '28px', padding: '0 14px', fontSize: '12px', gap: '6px' },
  md: { height: '36px', padding: '0 16px', fontSize: '14px', gap: '8px' },
  lg: { height: '48px', padding: '0 20px', fontSize: '15px', gap: '8px' },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      fullWidth,
      iconOnly,
      interactive = true,
      style,
      children,
      disabled,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref,
  ) => {
    const [hovered, setHovered] = useState(false)

    const isDisabled = disabled || loading
    const showHover  = interactive && hovered && !isDisabled

    const hoverOverrides: React.CSSProperties = showHover
      ? {
          backgroundColor: variantHoverBg[variant],
          // Safe to set because base styles use borderColor (longhand), not border (shorthand)
          ...(variantHoverBorderColor[variant]
            ? { borderColor: variantHoverBorderColor[variant] }
            : {}),
        }
      : {}

    const iconOnlyOverrides: React.CSSProperties = iconOnly
      ? { width: sizeStyles[size].height, padding: 0, gap: 0 }
      : {}

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        onMouseEnter={(e) => {
          setHovered(true)
          onMouseEnter?.(e)
        }}
        onMouseLeave={(e) => {
          setHovered(false)
          onMouseLeave?.(e)
        }}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          fontFamily:     'var(--font-sans)',
          fontWeight:     600,
          letterSpacing:  '0.01em',
          borderRadius:   'var(--radius-md)',
          cursor:         isDisabled ? 'not-allowed' : 'pointer',
          opacity:        isDisabled ? 0.6 : 1,
          transition:     'background-color 120ms ease, border-color 120ms ease',
          width:          fullWidth ? '100%' : undefined,
          ...variantStyles[variant],
          ...sizeStyles[size],
          ...hoverOverrides,
          ...iconOnlyOverrides,
          ...style,
        }}
        {...props}
      >
        {loading && (
          <span style={{
            width:          '14px',
            height:         '14px',
            border:         '2px solid rgba(255,255,255,0.4)',
            borderTopColor: variant === 'primary' || variant === 'danger' ? 'var(--color-text-inverse)' : 'var(--color-text-primary)',
            borderRadius:   '50%',
            display:        'inline-block',
            animation:      'btn-spin 600ms linear infinite',
          }} />
        )}
        {(!loading || !iconOnly) && children}
        <style>{`@keyframes btn-spin { to { transform: rotate(360deg); } }`}</style>
      </button>
    )
  }
)

Button.displayName = 'Button'