import { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '240px', gap: '12px', textAlign: 'center',
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--color-surface)',
    }}>
      {icon && (
        <div style={{ color: 'var(--color-text-tertiary)' }}>
          {icon}
        </div>
      )}
      <p style={{
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: 'var(--color-text-primary)',
      }}>
        {title}
      </p>
      {description && (
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          color: 'var(--color-text-secondary)',
          maxWidth: '260px',
        }}>
          {description}
        </p>
      )}
      {action && (
        <div style={{ marginTop: '4px' }}>
          {action}
        </div>
      )}
    </div>
  )
}