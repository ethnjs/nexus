
type Size = 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: Size
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { width: '24px', height: '24px', border: '2px solid rgba(255,255,255,0.4)' },
  md: { width: '48px', height: '48px', border: '3px solid rgba(255,255,255,0.4)' },
  lg: { width: '64px', height: '64px', border: '4px solid rgba(255,255,255,0.4)' }
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  return (
    <span style={{
      ...sizeStyles[size],
      borderTopColor: 'var(--color-text-primary)',
      borderRadius:   '50%',
      display:        'inline-block',
      animation:      'btn-spin 600ms linear infinite',
    }}>
      <style>{`@keyframes btn-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  )
}
