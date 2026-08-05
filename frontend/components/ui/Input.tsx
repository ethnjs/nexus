'use client'

import { forwardRef, InputHTMLAttributes, useId } from 'react'

type InputFont  = 'sans' | 'mono' | 'serif'
type InputSize  = 'xs' | 'sm' | 'md'
// primary -- light gray; secondary -- white
type InputStyleType = 'primary' | 'secondary'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?:     string
  error?:     string
  helper?:    string
  fullWidth?: boolean
  font?:      InputFont
  size?:      InputSize
  styleType?: InputStyleType

  locked?:    boolean
}

const FONT_MAP: Record<InputFont, string> = {
  sans:  'var(--font-sans)',
  mono:  'var(--font-mono)',
  serif: 'var(--font-serif)',
}

const SIZE_MAP: Record<InputSize, { height: string; paddingX: string; fontSize: string }> = {
  xs: { height: '26px', paddingX: '8px', fontSize: '12px' },
  sm: { height: '32px', paddingX: '10px', fontSize: '13px' },
  md: { height: '44px', paddingX: '16px', fontSize: '14px' },
}

const BACKGROUND_MAP: Record<InputStyleType, string> = {
  primary:   'var(--color-bg)',
  secondary: 'var(--color-surface)',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, fullWidth, font = 'mono', size = 'md', styleType = 'primary', className = '', id, value, locked, disabled, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const sizing = SIZE_MAP[size]

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: fullWidth ? '100%' : undefined }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={locked || disabled}
          style={{
            height: sizing.height,
            paddingLeft: sizing.paddingX,
            paddingRight: sizing.paddingX,
            fontFamily: FONT_MAP[font],
            fontSize: sizing.fontSize,
            background: locked ? 'var(--color-accent-subtle)' : BACKGROUND_MAP[styleType],
            color: locked ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
            border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            width: fullWidth ? '100%' : undefined,
            cursor: locked ? 'not-allowed' : undefined,
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