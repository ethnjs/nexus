'use client'

import { forwardRef, InputHTMLAttributes, useId } from 'react'

type InputFont = 'sans' | 'mono' | 'serif'
type InputSize = 'sm' | 'md'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?:     string
  error?:     string
  helper?:    string
  fullWidth?: boolean
  font?:      InputFont
  size?:      InputSize
}

const FONT_MAP: Record<InputFont, string> = {
  sans:  'var(--font-sans)',
  mono:  'var(--font-mono)',
  serif: 'var(--font-serif)',
}

const SIZE_MAP: Record<InputSize, { height: string; paddingX: string; fontSize: string }> = {
  sm: { height: '32px', paddingX: '10px', fontSize: '13px' },
  md: { height: '44px', paddingX: '16px', fontSize: '14px' },
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, fullWidth, font = 'mono', size = 'md', className = '', id, value, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const sizing = SIZE_MAP[size]

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: fullWidth ? '100%' : undefined }}>
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
            height: sizing.height,
            paddingLeft: sizing.paddingX,
            paddingRight: sizing.paddingX,
            fontFamily: FONT_MAP[font],
            fontSize: sizing.fontSize,
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
          value={value ?? ''}
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