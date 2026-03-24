interface StatCardProps {
  label: string
  value: number | string
  color?: string
}

export function StatCard({ label, value, color = 'var(--color-text-primary)' }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: '20px',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'Georgia, serif',
        fontSize: '36px',
        color,
        lineHeight: 1,
        marginBottom: '6px',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: 'var(--color-text-tertiary)',
      }}>
        {label}
      </div>
    </div>
  )
}