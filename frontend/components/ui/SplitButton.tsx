'use client'

import { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Popover } from '@/components/ui/Popover'
import { IconChevronDown } from '@/components/ui/Icons'

export interface SplitButtonOption {
  label: string
  /** Secondary line under the label — same field name as DropdownOption.subtitle. */
  subtitle?: string
  icon?: ReactNode
  action: () => void
  /** Visually distinct destructive style — e.g. Delete next to a plain Archive. */
  danger?: boolean
}

interface SplitButtonProps {
  /** Label shown on the primary left segment */
  label: string
  /** Called when the primary left segment is clicked */
  onClick: () => void
  /** Dropdown options shown when the chevron is clicked */
  options: SplitButtonOption[]
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
}

// A primary action segment plus a chevron that opens a menu of secondary
// actions — composed from Button (both segments) and Popover (the menu),
// rather than reimplementing hover/focus/positioning from scratch.
export function SplitButton({
  label,
  onClick,
  options,
  variant = 'secondary',
  size = 'sm',
  loading = false,
  disabled = false,
}: SplitButtonProps) {
  return (
    <div style={{ display: 'inline-flex' }}>
      <Button
        variant={variant}
        size={size}
        loading={loading}
        disabled={disabled}
        onClick={onClick}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }}
      >
        {label}
      </Button>

      <Popover
        trigger={
          <Button
            variant={variant}
            size={size}
            disabled={disabled || loading}
            iconOnly
            aria-label="More options"
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
          >
            <IconChevronDown size={12} />
          </Button>
        }
        items={options}
        getKey={(opt) => opt.label}
        align="right"
        width={220}
        onSelect={(opt) => opt.action()}
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
