import { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /**
   * `md` (default) is the full-page box: 240px tall, stacked, serif title.
   * `sm` is a one-line strip that fills its container's width and takes only
   * the height it needs — for an empty slot *inside* a populated page, like
   * an unstaffed row on a board, where the tall box would dwarf the rows
   * around it and repeat down the page.
   */
  size?: 'sm' | 'md'
  /**
   * Drops the filled background, keeping the dashed outline. For an empty
   * slot laid *over* something the reader still needs to see — a day's
   * availability shading behind an unstaffed timeline, where the usual
   * surface fill would blank out the answer the row was drawn to give.
   */
  transparent?: boolean
}

export function EmptyState({ icon, title, description, action, size = 'md', transparent = false }: EmptyStateProps) {
  const compact = size === 'sm'
  return (
    <div style={{
      display: 'flex',
      flexDirection: compact ? 'row' : 'column',
      alignItems: 'center', justifyContent: 'center',
      height: compact ? undefined : '240px',
      padding: compact ? '10px 12px' : undefined,
      gap: compact ? '8px' : '12px', textAlign: 'center',
      border: '1px dashed var(--color-border)',
      borderRadius: compact ? 'var(--radius-md)' : 'var(--radius-lg)',
      background: transparent ? 'transparent' : 'var(--color-surface)',
    }}>
      {icon && (
        <div style={{ color: 'var(--color-text-tertiary)', display: 'flex' }}>
          {icon}
        </div>
      )}
      <p style={{
        fontFamily: compact ? 'var(--font-sans)' : 'Georgia, serif',
        fontSize: compact ? '12px' : '20px',
        color: compact ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
      }}>
        {title}
      </p>
      {description && (
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: compact ? '12px' : '13px',
          color: 'var(--color-text-secondary)',
          maxWidth: compact ? undefined : '260px',
        }}>
          {description}
        </p>
      )}
      {action && (
        <div style={{ marginTop: compact ? 0 : '4px' }}>
          {action}
        </div>
      )}
    </div>
  )
}