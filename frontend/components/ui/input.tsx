'use client'

import { forwardRef, InputHTMLAttributes, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:   string
  error?:   string
  helper?:  string
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, fullWidth, className = '', id, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId

    return (
      <div className={['flex flex-col gap-1.5', fullWidth ? 'w-full' : ''].join(' ')}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-secondary uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'h-8 px-3 text-sm',
            'bg-surface text-primary',
            'border rounded-sm',
            'transition-all duration-base',
            'placeholder:text-tertiary',
            'focus:outline-none focus:ring-1',
            error
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-border focus:border-accent focus:ring-accent',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-accent-subtle',
            fullWidth ? 'w-full' : '',
            className,
          ].join(' ')}
          {...props}
        />
        {error && (
          <p className="text-xs text-danger">{error}</p>
        )}
        {helper && !error && (
          <p className="text-xs text-tertiary">{helper}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'