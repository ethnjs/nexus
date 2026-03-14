'use client'

import { forwardRef, InputHTMLAttributes, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:     string
  error?:     string
  helper?:    string
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, fullWidth, className = '', id, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: fullWidth ? '100%' : undefined }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 400,
              color: 'var(--color-text-secondary)',
            }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          style={{
            height: '44px',
            paddingLeft: '16px',
            paddingRight: '16px',
            fontFamily: 'var(--font-display)',
            fontSize: '14px',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
            width: fullWidth ? '100%' : undefined,
            transition: 'border-color 150ms ease',
          }}
          onFocus={e => {
            e.target.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border-strong)'
          }}
          onBlur={e => {
            e.target.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)'
          }}
          className={className}
          {...props}
        />
        {error && (
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
        {helper && !error && (
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
            {helper}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'