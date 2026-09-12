'use client'

import {
  forwardRef, InputHTMLAttributes, ChangeEvent, ReactNode, useId, useImperativeHandle, useRef,
} from 'react'

import { IconX } from '@/components/ui/Icons'

type InputFont  = 'sans' | 'mono' | 'serif'
type InputSize  = 'xs' | 'sm' | 'md' | 'lg'
// primary -- light gray; secondary -- white
type InputVariant = 'primary' | 'secondary'
export type InputCharset = 'numeric' | 'alpha' | 'alphanumeric'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?:     string
  /** Rendered inline next to the label — e.g. an info icon + Tooltip explaining the field. Ignored when label isn't set. */
  labelExtra?: ReactNode
  error?:     string
  helper?:    string
  fullWidth?: boolean
  font?:      InputFont
  size?:      InputSize
  variant?: InputVariant
  locked?:    boolean
  charset?:   InputCharset
  /** Leading icon (e.g. a search glyph) rendered inside the field's left edge. */
  icon?:      ReactNode
  /** Given, the field grows a trailing "x" while it has a value. Takes a
   *  callback rather than clearing itself: the value is the caller's state,
   *  and firing onChange with a hand-built event would hand every listener a
   *  fake target. Focus returns to the field after a clear, since clearing a
   *  search is nearly always followed by typing a different one. */
  onClear?:   () => void
}

const FONT_MAP: Record<InputFont, string> = {
  sans:  'var(--font-sans)',
  mono:  'var(--font-mono)',
  serif: 'var(--font-serif)',
}

// Heights match Button's scale (more call sites app-wide) so the same size
// name means the same height on every form control.
const SIZE_MAP: Record<InputSize, { height: string; paddingX: string; fontSize: string }> = {
  xs: { height: '26px', paddingX: '8px', fontSize: '12px' },
  sm: { height: '28px', paddingX: '10px', fontSize: '13px' },
  md: { height: '36px', paddingX: '16px', fontSize: '14px' },
  lg: { height: '48px', paddingX: '20px', fontSize: '15px' },
}

const BACKGROUND_MAP: Record<InputVariant, string> = {
  primary:   'var(--color-bg)',
  secondary: 'var(--color-surface)',
}

// Letters/numbers charsets also allow whitespace — a strict alpha-only
// filter would block real-world names ("St. Mary's", "Team A-1").
const CHARSET_PATTERNS: Record<InputCharset, RegExp> = {
  numeric:      /[^0-9]/g,
  alpha:        /[^a-zA-Z\s]/g,
  alphanumeric: /[^a-zA-Z0-9\s]/g,
}

/** The trailing "x". A native button, not Button: the smallest Button is
 *  28px with a border, which cannot sit inside a 26px field. onMouseDown is
 *  prevented so the click doesn't blur the input first — the focus we hand
 *  back afterwards would otherwise be a visible flicker. */
function ClearButton({ right, onClear }: { right: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label="Clear"
      title="Clear"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
      style={{
        position: 'absolute', right, top: '50%', transform: 'translateY(-50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, width: '14px', height: '14px',
        border: 'none', background: 'transparent', borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text-tertiary)', cursor: 'pointer',
        transition: 'color 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
    >
      <IconX size={12} />
    </button>
  )
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, labelExtra, error, helper, fullWidth, font = 'mono', size = 'md', variant = 'primary', className = '', id, value, locked, disabled, required, charset, icon, onClear, onChange, inputMode, max, onFocus, onBlur, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const sizing = SIZE_MAP[size]
    // Both this component and the caller need the node: the caller for its
    // own focus/scroll, this for the focus that follows a clear.
    const innerRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => innerRef.current as HTMLInputElement)

    const clearable = !!onClear && !locked && !disabled
    const showClear = clearable && String(value ?? '').length > 0

    function handleClear() {
      onClear?.()
      innerRef.current?.focus()
    }

    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      if (charset) {
        const filtered = e.target.value.replace(CHARSET_PATTERNS[charset], '')
        if (filtered !== e.target.value) e.target.value = filtered
      }
      onChange?.(e)
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: fullWidth ? '100%' : undefined }}>
        {label && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
              {required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
            </label>
            {labelExtra}
          </div>
        )}
        <div style={{ position: 'relative', width: fullWidth ? '100%' : undefined }}>
          {icon && (
            <span style={{
              position: 'absolute', left: sizing.paddingX, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', color: 'var(--color-text-tertiary)', pointerEvents: 'none',
            }}>
              {icon}
            </span>
          )}
          <input
            ref={innerRef}
            id={inputId}
            disabled={locked || disabled}
            inputMode={inputMode ?? (charset === 'numeric' ? 'numeric' : undefined)}
            // type="date"/"datetime-local" allow years up to 6 digits by spec, which breaks
            // any lexicographic YYYY-MM-DD string comparison downstream.
            max={
              props.type === 'date' ? (max ?? '9999-12-31')
              : props.type === 'datetime-local' ? (max ?? '9999-12-31T23:59')
              : max
            }
            onChange={handleChange}
            style={{
              height: sizing.height,
              paddingLeft: icon ? `calc(${sizing.paddingX} * 2 + 14px)` : sizing.paddingX,
              paddingRight: clearable ? `calc(${sizing.paddingX} * 2 + 12px)` : sizing.paddingX,
              fontFamily: FONT_MAP[font],
              fontSize: sizing.fontSize,
              background: locked ? 'var(--color-accent-subtle)' : error ? 'var(--color-danger-subtle)' : BACKGROUND_MAP[variant],
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
              onFocus?.(e)
            }}
            onBlur={e => {
              e.target.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)'
              onBlur?.(e)
            }}
            className={className}
            value={value ?? ''}
            {...props}
          />
          {showClear && <ClearButton right={sizing.paddingX} onClear={handleClear} />}
        </div>
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