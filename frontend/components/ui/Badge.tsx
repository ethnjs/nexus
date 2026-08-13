'use client'

import { HTMLAttributes, MouseEvent, useState } from 'react'

type BadgeVariant =
  | 'default'
  | 'interested'
  | 'confirmed'
  | 'declined'
  | 'assigned'
  | 'removed'
  | 'admin'
  | 'td'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  /** When set, clicking the badge copies this value to the clipboard and flashes a "Copied!" tag. */
  copyValue?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default:    'bg-accent-subtle text-secondary border-border',
  interested: 'bg-accent-subtle text-secondary border-border',
  confirmed:  'bg-success-subtle text-success border-success/20',
  declined:   'bg-danger-subtle text-danger border-danger/20',
  assigned:   'bg-blue-50 text-blue-700 border-blue-200',
  removed:    'bg-accent-subtle text-tertiary border-border',
  admin:      'bg-accent text-inverse border-accent',
  td:         'bg-accent-subtle text-primary border-border-strong',
}

export function Badge({ variant = 'default', className = '', children, copyValue, onClick, style, ...props }: BadgeProps) {
  const [copied, setCopied] = useState(false)

  async function handleClick(e: MouseEvent<HTMLSpanElement>) {
    // Copying is a self-contained action — don't let it also trigger
    // whatever a clickable ancestor (e.g. an expandable row) does.
    e.stopPropagation()
    onClick?.(e)
    if (!copyValue) return
    await navigator.clipboard.writeText(copyValue)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span
      onClick={copyValue ? handleClick : onClick}
      className={[
        'inline-flex items-center px-2 py-0.5',
        'text-2xs font-medium uppercase tracking-wider',
        'border rounded-sm',
        variantStyles[variant],
        className,
      ].join(' ')}
      style={copyValue ? { cursor: 'pointer', position: 'relative', ...style } : style}
      {...props}
    >
      {children}
      {copied && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)',
          padding: '3px 8px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
          background: 'var(--color-text-primary)', color: 'var(--color-text-inverse)',
          fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 500, textTransform: 'none',
          letterSpacing: 'normal', zIndex: 10,
        }}>
          Copied!
        </span>
      )}
    </span>
  )
}
