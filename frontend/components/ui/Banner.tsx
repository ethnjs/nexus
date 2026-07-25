'use client'

import { ReactNode } from 'react'
import { IconXCircle, IconWarning, IconCheckCircle, IconInfo, IconX } from '@/components/ui/Icons'

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
  bg: string; border: string; iconColor: string; icon: ReactNode; dismissHoverBg: string
}> = {
  success: {
    bg:             'var(--color-surface)',
    border:         'var(--color-success)',
    iconColor:      'var(--color-success)',
    icon:           <IconCheckCircle size={20} />,
    dismissHoverBg: 'rgba(34,197,94,0.12)',
  },
  error: {
    bg:             'var(--color-danger-subtle)',
    border:         'var(--color-danger)',
    iconColor:      'var(--color-danger)',
    icon:           <IconXCircle size={20} />,
    dismissHoverBg: 'rgba(229,62,62,0.12)',
  },
  warning: {
    bg:             'var(--color-warning-subtle)',
    border:         'var(--color-warning)',
    iconColor:      'var(--color-warning)',
    icon:           <IconWarning size={20} />,
    dismissHoverBg: 'rgba(234,179,8,0.12)',
  },
  info: {
    bg:             'var(--color-surface)',
    border:         'var(--color-border-strong)',
    iconColor:      'var(--color-text-secondary)',
    icon:           <IconInfo size={20} />,
    dismissHoverBg: 'rgba(0,0,0,0.06)',
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
            background:   'none',
            border:       'none',
            cursor:       'pointer',
            color:        'var(--color-text-tertiary)',
            width:        '28px',
            height:       '28px',
            padding:      '0',
            borderRadius: 'var(--radius-sm)',
            flexShrink:   0,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-text-primary)';
            e.currentTarget.style.background = t.dismissHoverBg;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-tertiary)';
            e.currentTarget.style.background = 'none';
          }}
        >
          <IconX />
        </button>
      )}
    </div>
  )
}