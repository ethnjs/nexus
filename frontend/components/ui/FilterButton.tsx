'use client'

import { Button } from '@/components/ui/Button'
import { SplitButton } from '@/components/ui/SplitButton'
import { IconFilter, IconX } from '@/components/ui/Icons'

interface FilterButtonProps {
  /** Whether any filter is currently narrowing the list. */
  active: boolean
  /** Opens the page's filter modal. */
  onOpen: () => void
  /** Drops every filter at once. */
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
 * While filtered it becomes a SplitButton whose right segment clears, and
 * turns primary (black) so a narrowed list is visible from the toolbar alone.
 */
export function FilterButton({
  active, onOpen, onClear, size = 'md', iconOnly = false, label = 'Filter',
}: FilterButtonProps) {
  const iconSize = size === 'sm' ? 14 : 16
  if (!active) {
    return iconOnly ? (
      <Button type="button" variant="secondary" size={size} iconOnly title={label} aria-label={label} onClick={onOpen}>
        <IconFilter size={iconSize} />
      </Button>
    ) : (
      <Button type="button" variant="secondary" size={size} onClick={onOpen} style={{ flexShrink: 0 }}>
        <IconFilter size={iconSize} /> {label}
      </Button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <SplitButton
        variant="primary"
        size={size}
        icon={<IconFilter size={iconSize} />}
        label={label}
        iconOnly={iconOnly}
        onClick={onOpen}
        action={{ icon: <IconX size={size === 'sm' ? 12 : 14} />, label: 'Clear filters', onClick: onClear }}
      />
    </span>
  )
}
