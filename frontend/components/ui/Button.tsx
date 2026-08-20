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

// Use longhand border properties throughout so hover can safely override
// borderColor without conflicting with the shorthand `border` property.
const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    background:   'var(--color-accent)',
    color:        'var(--color-text-inverse)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-accent)',
  },
  secondary: {
    background:   'var(--color-surface)',
    color:        'var(--color-text-primary)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-border)',
  },
  ghost: {
    background:   'transparent',
    color:        'var(--color-text-primary)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'transparent',
  },
  danger: {
    background:   'var(--color-danger)',
    color:        'var(--color-text-inverse)',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-danger)',
  },
}

/** Background applied on hover per variant */
const variantHoverBg: Record<Variant, string> = {
  primary:   'var(--color-accent-hover)',
  secondary: 'var(--color-accent-subtle)',
  ghost:     'var(--color-accent-subtle)',
  danger:    'var(--color-danger-hover)',
}

/** Border color applied on hover (null = no change) */
const variantHoverBorderColor: Record<Variant, string | null> = {
  primary:   null,
  secondary: 'var(--color-border-strong)',
  ghost:     null,
  danger:    null,
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
          background:  variantHoverBg[variant],
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
          transition:     'background 120ms ease, border-color 120ms ease',
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