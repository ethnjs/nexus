'use client'

import { ToolbarConfigButton } from '@/components/ui/ToolbarConfigButton'
import { IconSort } from '@/components/ui/Icons'

interface SortButtonProps {
  /** Whether the current sort differs from this surface's default. */
  active: boolean
  onOpen: () => void
  /** Back to the default chain in one press. */
  onReset: () => void
  size?: 'sm' | 'md'
  iconOnly?: boolean
  label?: string
}

/**
 * The toolbar's Sort control — FilterButton and DisplayButton's third
 * sibling, and the same bargain: one button, with the way back folded into
 * its edge instead of a second button that appears and reflows the toolbar.
 */
export function SortButton({
  active, onOpen, onReset, size = 'md', iconOnly = false, label = 'Sort',
}: SortButtonProps) {
  return (
    <ToolbarConfigButton
      active={active}
      icon={<IconSort size={size === 'sm' ? 14 : 16} />}
      label={label}
      actionLabel="Reset sort"
      onOpen={onOpen}
      onClear={onReset}
      size={size}
      iconOnly={iconOnly}
    />
  )
}
