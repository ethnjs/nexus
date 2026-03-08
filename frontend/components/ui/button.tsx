'use client'

import { forwardRef, ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size    = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?:    Size
  loading?: boolean
  fullWidth?: boolean
}

const variantStyles: Record<Variant, string> = {
  primary:   'bg-accent text-inverse border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface text-primary border-border hover:border-border-strong hover:bg-accent-subtle',
  ghost:     'bg-transparent text-primary border-transparent hover:bg-accent-subtle hover:border-border',
  danger:    'bg-danger text-inverse border-danger hover:opacity-90',
}

const sizeStyles: Record<Size, string> = {
  sm: 'h-7 px-3 text-xs gap-1.5',
  md: 'h-8 px-4 text-sm gap-2',
  lg: 'h-10 px-5 text-base gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, fullWidth, className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          // Base
          'inline-flex items-center justify-center font-sans font-medium',
          'border rounded-sm transition-all duration-base',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
          // Variant
          variantStyles[variant],
          // Size
          sizeStyles[size],
          // Full width
          fullWidth ? 'w-full' : '',
          className,
        ].join(' ')}
        {...props}
      >
        {loading && (
          <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'