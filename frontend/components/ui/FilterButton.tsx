'use client'

import { ToolbarConfigButton } from '@/components/ui/ToolbarConfigButton'
import { IconFilter } from '@/components/ui/Icons'

interface FilterButtonProps {
  /** Whether any filter is currently narrowing the list. */
  active: boolean
  /** Opens the page's filter modal. */
  onOpen: () => void
  /** Drops every filter at once — or, on a surface with defaults of its own,
   *  puts them back. */
  onClear: () => void
  size?: 'sm' | 'md'
  /** Funnel only, no label — for a panel header. The label becomes the
   *  tooltip, so it still says what it filters. */
  iconOnly?: boolean
  /** Tooltip / accessible name when iconOnly. */
  label?: string
}

/**
 * The toolbar's Filter control, with its clear action folded in.
 *
 * Replaces a Filter button plus a separate "Clear filters" button that only
 * appeared once something was applied — that second button made the toolbar
 * reflow every time a filter came on or off, and cost a whole button's width.
 * The shape itself now lives in ToolbarConfigButton, which the display
 * config button uses for the same reason.
 */
export function FilterButton({
  active, onOpen, onClear, size = 'md', iconOnly = false, label = 'Filter',
}: FilterButtonProps) {
  return (
    <ToolbarConfigButton
      active={active}
      icon={<IconFilter size={size === 'sm' ? 14 : 16} />}
      label={label}
      actionLabel="Clear filters"
      onOpen={onOpen}
      onClear={onClear}
      size={size}
      iconOnly={iconOnly}
    />
  )
}
