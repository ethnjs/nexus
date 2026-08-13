import { ReactNode } from 'react'
import { Card } from './Card'

interface PageHeaderProps {
  heading:     string
  subheading?: string
  metadata?:   ReactNode
  action?:     ReactNode
}

export function PageHeader({ heading, subheading, metadata, action }: PageHeaderProps) {
  return (
    <Card radius="lg" style={{
      marginBottom: '24px', padding: '20px 28px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px',
    }}>
      <div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '28px', lineHeight: 1.2 }}>
          {heading}
        </h1>
        {subheading && (
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: '13px',
            color: 'var(--color-text-secondary)', marginTop: '4px',
          }}>
            {subheading}
          </p>
        )}
        {metadata && (
          <div style={{ marginTop: '8px' }}>
            {metadata}
          </div>
        )}
      </div>
      {action && (
        <div style={{ flexShrink: 0 }}>
          {action}
        </div>
      )}
    </Card>
  )
}
