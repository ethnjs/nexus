'use client'

import { forwardRef, TextareaHTMLAttributes, useId } from "react"

type InputFont = 'sans' | 'mono' | 'serif'

interface TextProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  fullWidth?: boolean
  rows?: number
  font?: InputFont
}

const FONT_MAP: Record<InputFont, string> = {
  sans:  'var(--font-sans)',
  mono:  'var(--font-mono)',
  serif: 'var(--font-serif)',
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextProps>(
  ({ label, error, fullWidth, rows = 4, font='mono', className='', id, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: fullWidth ? '100%' : undefined }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 400, color: 'var(--color-text-secondary)'}}
          >{label}</label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          style={{
            padding: '16px',
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
      </div>
    )
  }
)