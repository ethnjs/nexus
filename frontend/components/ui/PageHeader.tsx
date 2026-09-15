import { ReactNode } from 'react'
import { Card } from './Card'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  heading:     string
  subheading?: string
  metadata?:   ReactNode
  action?:     ReactNode
}

export function PageHeader({ heading, subheading, metadata, action }: PageHeaderProps) {
  return (
    <Card radius="lg" className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.heading}>
          {heading}
        </h1>
        {subheading && (
          <p className={styles.subheading}>
            {subheading}
          </p>
        )}
        {metadata && (
          <div className={styles.metadata}>
            {metadata}
          </div>
        )}
      </div>
      {action && (
        <div className={styles.action}>
          {action}
        </div>
      )}
    </Card>
  )
}
