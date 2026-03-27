'use client'

import { forwardRef, InputHTMLAttributes, useId } from 'react'

type InputFont = 'sans' | 'mono' | 'serif'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:     string
  error?:     string
  helper?:    string
  fullWidth?: boolean
  /**
   * Font family for the input field.
   * "sans" (default) — var(--font-sans)
   * "mono"           — var(--font-mono)
   * "serif"          — var(--font-serif)
   */
  font?:      InputFont
}

const FONT_MAP: Record<InputFont, string> = {
  sans:  'var(--font-sans)',
  mono:  'var(--font-mono)',
  serif: 'var(--font-serif)',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, fullWidth, font = 'sans', className = '', id, ...props }, ref) => {
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
            fontFamily: FONT_MAP[font],
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
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
        {helper && !error && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
            {helper}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'