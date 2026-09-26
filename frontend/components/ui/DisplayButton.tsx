'use client'

import { ToolbarConfigButton } from '@/components/ui/ToolbarConfigButton'
import { IconEye } from '@/components/ui/Icons'

interface DisplayButtonProps {
  /** Whether what is shown differs from this surface's default view. */
  active: boolean
  /** Opens the display config modal. */
  onOpen: () => void
  /** Puts the view back to its default in one press. */
  onReset: () => void
  size?: 'sm' | 'md'
  /** Eye only, no label — for a panel header. */
  iconOnly?: boolean
  /** Label, and the tooltip when iconOnly. */
  label?: string
}

/**
 * The toolbar's Display control — FilterButton's twin, for what is *shown*
 * rather than what is *listed*.
 *
 * Same argument for folding the reset in: a view cut down to three fields
 * needs a way back that doesn't involve re-ticking nine checkboxes, and a
 * separate Reset button beside it would reflow the toolbar every time the
 * view changed.
 */
export function DisplayButton({
  active, onOpen, onReset, size = 'md', iconOnly = false, label = 'Display',
}: DisplayButtonProps) {
  return (
    <ToolbarConfigButton
      active={active}
      icon={<IconEye size={size === 'sm' ? 14 : 16} />}
      label={label}
      actionLabel="Reset display"
      onOpen={onOpen}
      onClear={onReset}
      size={size}
      iconOnly={iconOnly}
    />
  )
}
