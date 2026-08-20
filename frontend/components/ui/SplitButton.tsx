'use client'

import { ReactNode, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Popover } from '@/components/ui/Popover'
import { IconChevronDown } from '@/components/ui/Icons'

export interface SplitButtonOption {
  label: string
  subtitle?: string
  icon?: ReactNode
  /** Fires immediately on click — may throw/reject, which the menu shows inline and stays open for. */
  action: () => void | Promise<void>
  /** Visually distinct destructive style — e.g. Delete next to a plain Archive. */
  danger?: boolean
  /** Renders inert with a tooltip instead of attempted-then-rejected — e.g. Delete when responses already exist. */
  disabled?: boolean
  disabledReason?: string
}

interface SplitButtonProps {
  /** Label shown on the primary left segment */
  label: string
  /** Called when the primary left segment is clicked */
  onClick: () => void
  /** Dropdown options shown when the chevron is clicked — each fires its own action immediately. */
  options: SplitButtonOption[]
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  loading?: boolean
  /** Disables both segments — the whole control is unusable. */
  disabled?: boolean
  /** Disables just the primary segment (e.g. it has no forward action right now) while the chevron menu stays usable. */
  primaryDisabled?: boolean
}

// A primary action segment plus a chevron that opens a menu of one-off
// secondary actions (Archive, Delete, ...) — composed from Button (both
// segments) and Popover (the menu) rather than reimplementing hover/focus/
// positioning from scratch.
export function SplitButton({
  label,
  onClick,
  options,
  variant = 'secondary',
  size = 'sm',
  loading = false,
  disabled = false,
  primaryDisabled = false,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false)
  const dividerColor = variant === 'primary' ? 'rgba(255,255,255,0.24)' : 'var(--color-border)'

  return (
    <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
      <Button
        variant={variant}
        size={size}
        loading={loading}
        disabled={disabled || primaryDisabled}
        onClick={onClick}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }}
      >
        {label}
      </Button>

      <div style={{ width: '1px', background: dividerColor, flexShrink: 0 }} />

      <Popover
        trigger={
          <Button
            variant={variant}
            size={size}
            disabled={disabled || loading}
            iconOnly
            aria-label="More options"
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }}
          >
            <IconChevronDown size={12} style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </Button>
        }
        items={options}
        getKey={(opt) => opt.label}
        align="right"
        width={240}
        onOpenChange={setOpen}
        onSelect={(opt) => opt.action()}
        isDisabled={(opt) => opt.disabled ?? false}
        disabledReason={(opt) => opt.disabledReason}
        renderLabel={(opt) => (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            {opt.icon && (
              <span style={{ flexShrink: 0, marginTop: '1px', color: opt.danger ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                {opt.icon}
              </span>
            )}
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, color: opt.danger ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                {opt.label}
              </div>
              {opt.subtitle && (
                <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                  {opt.subtitle}
                </div>
              )}
            </div>
          </div>
        )}
      />
    </div>
  )
}
