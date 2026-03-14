import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hoverable?: boolean
}

const paddingStyles = {
  none: '',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-6',
}

export function Card({ padding = 'md', hoverable, className = '', children, ...props }: CardProps) {
  return (
    <div
      className={[
        'bg-surface border border-border rounded-md',
        'shadow-sm',
        paddingStyles[padding],
        hoverable
          ? 'transition-all duration-base hover:border-border-strong hover:shadow-md cursor-pointer'
          : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}