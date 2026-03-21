import { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: '28px',
    }}>
      <div>
        <h1 style={{ fontSize: '28px', lineHeight: 1.2, marginBottom: subtitle ? '4px' : 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && (
        <div style={{ flexShrink: 0 }}>
          {action}
        </div>
      )}
    </div>
  )
}