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

/** A right segment that acts on click rather than opening a menu — e.g. the
 *  × that clears an applied filter. */
export interface SplitButtonAction {
  icon: ReactNode
  /** Tooltip and accessible name; the segment itself is icon-only. */
  label: string
  onClick: () => void
}

interface SplitButtonProps {
  /** Label shown on the primary left segment */
  label: string
  /** Rendered before the label on the primary segment. */
  icon?: ReactNode
  /** Primary segment shows only `icon`; `label` becomes its tooltip and
   *  accessible name. For a compact spot like a panel header. */
  iconOnly?: boolean
  /** Called when the primary left segment is clicked */
  onClick: () => void
  /** Dropdown options shown when the chevron is clicked — each fires its own action immediately. */
  options?: SplitButtonOption[]
  /** Replaces the chevron and its menu with one direct action. Takes
   *  precedence over `options` — a segment can't be both. */
  action?: SplitButtonAction
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
  icon,
  iconOnly = false,
  onClick,
  options = [],
  action,
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
        iconOnly={iconOnly}
        title={iconOnly ? label : undefined}
        aria-label={iconOnly ? label : undefined}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }}
      >
        {iconOnly ? icon : <>{icon}{icon ? ' ' : null}{label}</>}
      </Button>

      <div style={{ width: '1px', background: dividerColor, flexShrink: 0 }} />

      {action ? (
        <Button
          variant={variant}
          size={size}
          disabled={disabled || loading}
          iconOnly
          title={action.label}
          aria-label={action.label}
          onClick={action.onClick}
          style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }}
        >
          {action.icon}
        </Button>
      ) : (
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
      )}
    </div>
  )
}
