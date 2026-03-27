interface Step {
  key: string
  label: string
}

interface StepIndicatorProps {
  steps: Step[]
  current: string
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  const currentIdx = steps.findIndex((s) => s.key === current)

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '36px' }}>
      {steps.map((step, idx) => {
        const done   = idx < currentIdx
        const active = idx === currentIdx
        return (
          <div
            key={step.key}
            style={{
              display: 'flex', alignItems: 'center',
              flex: idx < steps.length - 1 ? 1 : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 700,
                flexShrink: 0,
                background: done || active ? 'var(--color-accent)' : 'transparent',
                color: done || active ? 'var(--color-text-inverse)' : 'var(--color-text-tertiary)',
                border: done || active ? 'none' : '1px solid var(--color-border)',
              }}>
                {done ? '✓' : idx + 1}
              </div>
              <span style={{
                fontFamily: 'var(--font-sans)', fontSize: '12px',
                fontWeight: active ? 600 : 400,
                color: active
                  ? 'var(--color-text-primary)'
                  : done
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-text-tertiary)',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div style={{
                flex: 1, height: '1px', margin: '0 12px',
                background: done ? 'var(--color-accent)' : 'var(--color-border)',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}