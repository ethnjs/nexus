import { ReactNode } from 'react'

interface FieldLabelProps {
  children: ReactNode
  htmlFor?: string
}

export function FieldLabel({ children, htmlFor }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: 'var(--color-text-tertiary)',
        display: 'block',
        marginBottom: '6px',
      }}
    >
      {children}
    </label>
  )
}