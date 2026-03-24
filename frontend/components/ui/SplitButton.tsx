'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'

export interface SplitButtonOption {
  label: string
  action: () => void
}

interface SplitButtonProps {
  /** Label shown on the primary left segment */
  label: string
  /** Called when the primary left segment is clicked */
  onClick: () => void
  /** Dropdown options shown when the chevron is clicked */
  options: SplitButtonOption[]
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
}

type Variant = 'primary' | 'secondary' | 'ghost'

const variantTokens: Record<Variant, {
  bg: string
  bgHover: string
  color: string
  border: string
  divider: string
  dropdownBg: string
  dropdownBorder: string
  dropdownItemHover: string
}> = {
  primary: {
    bg:               '#0A0A0A',
    bgHover:          '#2A2A2A',
    color:            '#FFFFFF',
    border:           '1px solid #0A0A0A',
    divider:          'rgba(255,255,255,0.2)',
    dropdownBg:       'var(--color-surface)',
    dropdownBorder:   'var(--color-border)',
    dropdownItemHover:'var(--color-accent-subtle)',
  },
  secondary: {
    bg:               'var(--color-surface)',
    bgHover:          'var(--color-accent-subtle)',
    color:            'var(--color-text-primary)',
    border:           '1px solid var(--color-border)',
    divider:          'var(--color-border)',
    dropdownBg:       'var(--color-surface)',
    dropdownBorder:   'var(--color-border)',
    dropdownItemHover:'var(--color-accent-subtle)',
  },
  ghost: {
    bg:               'transparent',
    bgHover:          'var(--color-accent-subtle)',
    color:            'var(--color-text-primary)',
    border:           '1px solid transparent',
    divider:          'var(--color-border)',
    dropdownBg:       'var(--color-surface)',
    dropdownBorder:   'var(--color-border)',
    dropdownItemHover:'var(--color-accent-subtle)',
  },
}

const sizeTokens = {
  sm: { height: '34px', fontSize: '12px', px: '12px', chevronW: '30px', gap: '6px' },
  md: { height: '38px', fontSize: '13px', px: '14px', chevronW: '34px', gap: '8px' },
}

export function SplitButton({
  label,
  onClick,
  options,
  variant = 'secondary',
  size = 'sm',
  loading = false,
  disabled = false,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false)
  const [mainHovered, setMainHovered] = useState(false)
  const [chevronHovered, setChevronHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const v = variantTokens[variant]
  const s = sizeTokens[size]

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const isDisabled = disabled || loading
  const mainBg  = mainHovered && !isDisabled ? v.bgHover : v.bg
  const chevBg  = chevronHovered && !isDisabled ? v.bgHover : v.bg

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Wrapper — gives shared border + radius */}
      <div style={{
        display: 'inline-flex',
        border: v.border,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'default',
      }}>
        {/* Primary segment */}
        <button
          onClick={() => !isDisabled && onClick()}
          onMouseEnter={() => setMainHovered(true)}
          onMouseLeave={() => setMainHovered(false)}
          disabled={isDisabled}
          style={{
            height: s.height,
            padding: `0 ${s.px}`,
            background: mainBg,
            color: v.color,
            border: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: s.fontSize,
            fontWeight: 600,
            letterSpacing: '0.01em',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: s.gap,
            transition: 'background 120ms ease',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? (
            <span style={{
              width: '12px', height: '12px',
              border: '2px solid rgba(255,255,255,0.35)',
              borderTopColor: variant === 'primary' ? '#fff' : 'var(--color-text-primary)',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'split-btn-spin 600ms linear infinite',
            }} />
          ) : null}
          {label}
          <style>{`@keyframes split-btn-spin { to { transform: rotate(360deg); } }`}</style>
        </button>

        {/* Divider */}
        <div style={{ width: '1px', background: v.divider, flexShrink: 0 }} />

        {/* Chevron segment */}
        <button
          onClick={() => !isDisabled && setOpen((x) => !x)}
          onMouseEnter={() => setChevronHovered(true)}
          onMouseLeave={() => setChevronHovered(false)}
          disabled={isDisabled}
          aria-label="More options"
          style={{
            width: s.chevronW,
            height: s.height,
            background: chevBg,
            color: v.color,
            border: 'none',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 120ms ease',
            flexShrink: 0,
          }}
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: `calc(${s.height} + 4px)`,
          right: 0,
          minWidth: '140px',
          background: v.dropdownBg,
          border: `1px solid ${v.dropdownBorder}`,
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
          zIndex: 60,
        }}>
          {options.map((opt, i) => (
            <button
              key={opt.label}
              onClick={() => { opt.action(); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '9px 14px',
                border: 'none',
                background: 'transparent',
                fontFamily: 'var(--font-sans)',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                textAlign: 'left',
                cursor: 'pointer',
                borderBottom: i < options.length - 1 ? '1px solid var(--color-border)' : 'none',
                transition: 'background 100ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = v.dropdownItemHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}