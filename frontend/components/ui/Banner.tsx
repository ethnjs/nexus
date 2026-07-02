'use client'

import { ReactNode } from 'react'
import { IconXCircle, IconWarning, IconCheckCircle, IconInfo } from '@/components/ui/Icons'

type BannerVariant = 'success' | 'error' | 'warning' | 'info'

export interface BannerProps {
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
    icon:      <IconCheckCircle size={20} />,
  },
  error: {
    bg:        'var(--color-danger-subtle)',
    border:    'var(--color-danger)',
    iconColor: 'var(--color-danger)',
    icon:      <IconXCircle size={20} />,
  },
  warning: {
    bg:        'var(--color-warning-subtle)',
    border:    'var(--color-warning)',
    iconColor: 'var(--color-warning)',
    icon:      <IconWarning size={20} />,
  },
  info: {
    bg:        'var(--color-surface)',
    border:    'var(--color-border-strong)',
    iconColor: 'var(--color-text-secondary)',
    icon:      <IconInfo size={20} />,
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
        fontSize:   '14px',
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