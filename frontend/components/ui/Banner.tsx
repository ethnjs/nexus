'use client'

import { ReactNode } from 'react'
import { IconXCircle, IconWarning, IconCheckCircle, IconInfo, IconX } from '@/components/ui/Icons'
import styles from './Banner.module.css'

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
    <div
      className={styles.banner}
      style={{
        background: t.bg,
        border:     `1px solid ${t.border}`,
        ['--dismiss-hover-bg' as string]: t.dismissHoverBg,
      }}
    >
      {/* Icon */}
      <span className={styles.icon} style={{ color: t.iconColor }}>
        {t.icon}
      </span>

      {/* Message */}
      <span className={styles.message}>
        {message}
      </span>

      {/* Optional action slot */}
      {action && (
        <div className={styles.action}>
          {action}
        </div>
      )}

      {/* Optional dismiss */}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={styles.dismiss}>
          <IconX />
        </button>
      )}
    </div>
  )
}