'use client'

import { ReactNode, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Popover } from '@/components/ui/Popover'
import { IconChevronDown } from '@/components/ui/Icons'

export interface SplitButtonOption {
  /** Stable key — matches SplitButtonProps.value to determine the checkmark and, indirectly, the primary segment's label. */
  value: string
  /** Shown in the dropdown row, and mirrored onto the primary segment once selected. */
  label: string
  subtitle?: string
  /** Shown left of the label when this option isn't the current selection — the selection itself always shows a checkmark instead. */
  icon?: ReactNode
  /** Visually distinct destructive style — e.g. Delete next to a plain Archive. */
  danger?: boolean
}

interface SplitButtonProps {
  /** The currently-selected option's value — drives the primary segment's label and which dropdown row shows a checkmark. */
  value: string
  options: SplitButtonOption[]
  /** Picking a different row in the dropdown — just changes the selection, no side effect. Confirm via onConfirm. */
  onSelect: (value: string) => void
  /** Clicking the primary segment — the actual action for whatever's currently selected. */
  onConfirm: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
}

// A primary segment (label mirrors the current selection) plus a chevron
// that opens a menu to change the selection — picking a menu row doesn't
// act on its own, it just updates what the primary segment will do when
// clicked. Composed from Button (both segments) and Popover (the menu)
// rather than reimplementing hover/focus/positioning from scratch.
export function SplitButton({
  value,
  options,
  onSelect,
  onConfirm,
  variant = 'secondary',
  size = 'sm',
  loading = false,
  disabled = false,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((opt) => opt.value === value)
  const dividerColor = variant === 'primary' ? 'rgba(255,255,255,0.24)' : 'var(--color-border)'

  return (
    <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
      <Button
        variant={variant}
        size={size}
        loading={loading}
        disabled={disabled}
        onClick={onConfirm}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }}
      >
        {selected?.label ?? value}
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
        getKey={(opt) => opt.value}
        align="right"
        width={240}
        onOpenChange={setOpen}
        onSelect={(opt) => onSelect(opt.value)}
        renderLabel={(opt) => {
          const isSelected = opt.value === value
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{
                flexShrink: 0, marginTop: '1px', width: '14px', display: 'flex', justifyContent: 'center',
                color: isSelected ? 'var(--color-accent)' : opt.danger ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              }}>
                {isSelected ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : opt.icon}
              </span>
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
          )
        }}
      />
    </div>
  )
}
