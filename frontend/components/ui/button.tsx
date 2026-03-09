'use client'

import { forwardRef, ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size    = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:   Variant
  size?:      Size
  loading?:   boolean
  fullWidth?: boolean
}

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    background: '#0A0A0A',
    color: '#FFFFFF',
    border: '1px solid #0A0A0A',
  },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text-primary)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'var(--color-danger)',
    color: '#FFFFFF',
    border: '1px solid var(--color-danger)',
  },
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { height: '32px', padding: '0 12px', fontSize: '13px', gap: '6px' },
  md: { height: '38px', padding: '0 16px', fontSize: '14px', gap: '8px' },
  lg: { height: '48px', padding: '0 20px', fontSize: '15px', gap: '8px' },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, fullWidth, style, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          letterSpacing: '0.01em',
          borderRadius: 'var(--radius-sm)',
          cursor: disabled || loading ? 'not-allowed' : 'pointer',
          opacity: disabled || loading ? 0.6 : 1,
          transition: 'opacity 150ms ease, background 150ms ease, border-color 150ms ease',
          width: fullWidth ? '100%' : undefined,
          ...variantStyles[variant],
          ...sizeStyles[size],
          ...style,
        }}
        {...props}
      >
        {loading && (
          <span style={{
            width: '14px',
            height: '14px',
            border: '2px solid rgba(255,255,255,0.4)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'spin 600ms linear infinite',
          }} />
        )}
        {children}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </button>
    )
  }
)

Button.displayName = 'Button'