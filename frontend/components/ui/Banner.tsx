'use client'

import { ReactNode } from 'react'
import { IconErrorCircle, IconWarningBanner, IconCheckCircle } from '@/components/ui/Icons'

type BannerVariant = 'success' | 'error' | 'warning' | 'info'

interface BannerProps {
  variant: BannerVariant
  message: string
  /** Optional ReactNode rendered to the right of the message — e.g. a Button */
  action?: ReactNode
  /** If provided, shows a dismiss (✕) button */
  onDismiss?: () => void
}

const variantTokens: Record<BannerVariant, {
  bg: string; border: string; iconColor: string; icon: ReactNode
}> = {
  success: {
    bg:        'var(--color-surface)',
    border:    'var(--color-success)',
    iconColor: 'var(--color-success)',
    icon:      <IconCheckCircle size={15} />,
  },
  error: {
    bg:        'var(--color-danger-subtle)',
    border:    'var(--color-danger)',
    iconColor: 'var(--color-danger)',
    icon:      <IconErrorCircle size={15} />,
  },
  warning: {
    bg:        'var(--color-warning-subtle)',
    border:    'var(--color-warning)',
    iconColor: 'var(--color-warning)',
    icon:      <IconWarningBanner size={17} />,
  },
  info: {
    bg:        'var(--color-surface)',
    border:    'var(--color-border-strong)',
    iconColor: 'var(--color-text-secondary)',
    // info keeps a simple character since it's rarely used
    icon:      <span style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1 }}>ℹ</span>,
  },
}

export function Banner({ variant, message, action, onDismiss }: BannerProps) {
  const t = variantTokens[variant]

  return (
    <div style={{
      display:      'flex',
      alignItems:   'center',
      gap:          '10px',
      background:   t.bg,
      border:       `1px solid ${t.border}`,
      borderRadius: 'var(--radius-md)',
      padding:      '10px 14px',
      boxShadow:    'var(--shadow-sm)',
    }}>
      {/* Icon */}
      <span style={{ color: t.iconColor, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {t.icon}
      </span>

      {/* Message */}
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontSize:   '13px',
        color:      'var(--color-text-primary)',
        flex:       1,
      }}>
        {message}
      </span>

      {/* Optional action slot */}
      {action && (
        <div style={{ flexShrink: 0 }}>
          {action}
        </div>
      )}

      {/* Optional dismiss */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background:  'none',
            border:      'none',
            cursor:      'pointer',
            fontFamily:  'var(--font-sans)',
            fontSize:    '12px',
            color:       'var(--color-text-tertiary)',
            padding:     '0 2px',
            lineHeight:  1,
            flexShrink:  0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
        >
          ✕
        </button>
      )}
    </div>
  )
}