import { HTMLAttributes } from 'react'

type BadgeVariant =
  | 'default'
  | 'interested'
  | 'confirmed'
  | 'declined'
  | 'assigned'
  | 'removed'
  | 'admin'
  | 'td'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, string> = {
  default:    'bg-accent-subtle text-secondary border-border',
  interested: 'bg-accent-subtle text-secondary border-border',
  confirmed:  'bg-success-subtle text-success border-success/20',
  declined:   'bg-danger-subtle text-danger border-danger/20',
  assigned:   'bg-blue-50 text-blue-700 border-blue-200',
  removed:    'bg-accent-subtle text-tertiary border-border',
  admin:      'bg-accent text-inverse border-accent',
  td:         'bg-accent-subtle text-primary border-border-strong',
}

export function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5',
        'text-2xs font-medium uppercase tracking-wider',
        'border rounded-sm',
        variantStyles[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </span>
  )
}