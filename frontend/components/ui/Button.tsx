'use client'

import { forwardRef, ButtonHTMLAttributes, useState } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size    = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:     Variant
  size?:        Size
  loading?:     boolean
  fullWidth?:   boolean
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
    background:   '#0A0A0A',
    color:        '#FFFFFF',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  '#0A0A0A',
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
    color:        '#FFFFFF',
    borderWidth:  '1px',
    borderStyle:  'solid',
    borderColor:  'var(--color-danger)',
  },
}

/** Background applied on hover per variant */
const variantHoverBg: Record<Variant, string> = {
  primary:   '#2A2A2A',
  secondary: 'var(--color-accent-subtle)',
  ghost:     'var(--color-accent-subtle)',
  danger:    '#C53030',
}

/** Border color applied on hover (null = no change) */
const variantHoverBorderColor: Record<Variant, string | null> = {
  primary:   null,
  secondary: 'var(--color-border-strong)',
  ghost:     null,
  danger:    null,
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { height: '36px', padding: '0 14px', fontSize: '13px', gap: '7px' },
  md: { height: '38px', padding: '0 16px', fontSize: '14px', gap: '8px' },
  lg: { height: '48px', padding: '0 20px', fontSize: '15px', gap: '8px' },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      fullWidth,
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
          ...style,
        }}
        {...props}
      >
        {loading && (
          <span style={{
            width:          '14px',
            height:         '14px',
            border:         '2px solid rgba(255,255,255,0.4)',
            borderTopColor: variant === 'primary' || variant === 'danger' ? '#fff' : 'var(--color-text-primary)',
            borderRadius:   '50%',
            display:        'inline-block',
            animation:      'btn-spin 600ms linear infinite',
          }} />
        )}
        {children}
        <style>{`@keyframes btn-spin { to { transform: rotate(360deg); } }`}</style>
      </button>
    )
  }
)

Button.displayName = 'Button'