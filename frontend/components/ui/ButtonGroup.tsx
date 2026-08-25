'use client'

import { Button } from "@/components/ui/Button"

export interface ButtonGroupOption {
  value:        string
  label:        string
  description?: string
}

interface ButtonGroupProps {
  options:    ButtonGroupOption[]
  /** A single value for single-select, or an array for multi-select (e.g. Division). */
  value:      string | string[]
  onChange:   (value: string) => void
  direction?: 'row' | 'column'
  size?:      'sm' | 'md'
  locked?:    boolean
  fullWidth?: boolean
  /** locked only. Lets clicks fall through to whatever this group sits inside,
      instead of being swallowed (a disabled control dispatches no click at
      all, to itself or its ancestors). Opt-in because most locked groups sit
      in a plain form where nothing wants the click — it exists for read-only
      question previews, whose container turns a click into "edit this". */
  clickThrough?: boolean
}

// Selected/unselected options rendered as primary/secondary Buttons — the
// style used for Division and Visibility, now shared by every yes/no or
// pick-one-of-a-few field instead of a radio-circle list.
export function ButtonGroup({ options, value, onChange, direction = 'row', size = 'sm', locked = false, fullWidth = false, clickThrough = false }: ButtonGroupProps) {
  const selected = Array.isArray(value) ? value : [value]
  const passThrough = locked && clickThrough

  return (
    <div style={{ display: 'flex', flexDirection: direction, gap: '8px', width: fullWidth ? '100%' : undefined }}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value)
        const button = (
          <Button
            key={opt.value}
            type="button"
            variant={isSelected ? 'primary' : 'secondary'}
            size={size}
            disabled={locked}
            fullWidth={fullWidth}
            onClick={() => onChange(opt.value)}
            style={{
              // Transparent to hit-testing so the wrapper below takes the
              // click the Button itself can never dispatch. Safe: it's
              // already non-interactive whenever this is on.
              ...(passThrough ? { pointerEvents: 'none' as const } : null),
              ...(opt.description ? {
                flexDirection: 'column', alignItems: 'flex-start', height: 'auto',
                padding: '10px 14px', textAlign: 'left', gap: '2px',
              } : null),
            }}
          >
            <span>{opt.label}</span>
            {opt.description && (
              <span style={{
                fontWeight: 400, fontSize: '12px',
                color: isSelected ? 'rgba(255,255,255,0.75)' : 'var(--color-text-tertiary)',
              }}>
                {opt.description}
              </span>
            )}
          </Button>
        )

        // Everywhere else the Button is the flex item, exactly as before. Only
        // a click-through group gets a wrapper, to carry the box (and the
        // option's identity) for the click the Button can't take. width (not
        // flex: 1) is what the Button's own fullWidth resolved to as a flex
        // item, so the group lays out the same — flex would additionally
        // stretch heights in a column group. The cursor is restated here
        // because the Button's own 'not-allowed' is unreachable once it stops
        // being hit-testable.
        if (!passThrough) return button
        return (
          <span
            key={opt.value}
            data-option-value={opt.value}
            style={{ display: 'flex', width: fullWidth ? '100%' : undefined, cursor: 'not-allowed' }}
          >
            {button}
          </span>
        )
      })}
    </div>
  )
}
